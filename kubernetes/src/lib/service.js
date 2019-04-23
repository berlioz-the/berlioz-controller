const _ = require('the-lodash');
const Promise = require('the-promise');
const request = require('request-promise');

const BaseProcessor = require('./base/base-processor');
const Invalidator = require('./base/invalidator');
const Pod = require('./pod');

class Service extends BaseProcessor
{
    constructor(logger, deployment, id)
    {
        super(logger, deployment)
        this._id = id; 
        this._parseClusterId();
        this._definition = null;
        this._nativePeers = {};
        this._provided = {};
        this._clusterProvided = {};
        this._consumed = {};
        this._policies = {};
        this._consumedMeta = [];

        this._podInvalidator = new Invalidator(logger.sublogger("PodInvalidator"));

        this._pods = {};
        this._providedPeerData = {};
        this._providedPeerDataByNode = {};
        this._consumedPeersData = {};
        this._consumerHandlers = {};

        this.registerHandler(this.invalidator.handle('pods', this.id, this._rebuildPods.bind(this)));
        this.registerHandler(this.invalidator.handle('metadata', this.id, this._rebuildMetadata.bind(this)));
        this.registerHandler(this._podInvalidator.handleAll('pod', this._onPodMetadataChanged.bind(this)));

        this.logger.info("[Service-constructor] %s :: %s...", this.deploymentName, this.id);
    }

    get id() {
        return this._id;
    }

    get deploymentName() {
        return this.parent.name;
    }

    get infra() {
        return this.parent.infra;
    }

    get clusterName() {
        return this._clusterName;
    }

    get clusterId() {
        return this._clusterId;
    }

    _parseClusterId()
    {
        var x = this.id.replace('service://', '');
        x = x.split('-');
        this._clusterName = x[0];
        this._clusterId = 'cluster://' + this._clusterName;
    }

    getProvidedMeta(name)
    {
        if (name in this._provided) {
            return this._provided[name];
        }
        return null;
    }

    getClusterProvided()
    {
        if (this._clusterProvided) {
            return this._clusterProvided;
        }
        return {};
    }

    handlePod(isPresent, pod)
    {
        this.logger.info("[%s :: %s] handlePod :: %s :: %s => %s", this.deploymentName, this.id, isPresent, pod.metadata.name, pod.status.phase)
        this.logger.info("[%s :: %s] handlePod :: %s :: %s => %s", this.deploymentName, this.id, isPresent, pod.metadata.name, pod.status.phase, pod)
        if (isPresent) {
            this._addPod(pod);
        } else {
            this._removePod(pod);
        }
    }

    handleDefinition(isPresent, svc)
    {
        this.logger.info("[%s :: %s] handleDefinition :: %s", this.deploymentName, this.id, isPresent)
        this.logger.info("[%s :: %s] handleDefinition :: %s", this.deploymentName, this.id, isPresent, svc)

        var targets = [];
        
        if (isPresent) {
            this._definition = svc;
            this._nativePeers = _.cloneDeep(svc.spec.nativePeers);
            this._consumed = _.cloneDeep(svc.spec.consumed);
            this._provided = svc.spec.provided;
            this._clusterProvided = svc.spec.clusterProvided;
            this._policies = svc.spec.policies;
            this._consumedMeta = svc.spec.consumedMeta;
            for(var consumed of _.values(this._consumed)) {
                consumed.key = [consumed.targetId, consumed.endpoint].join('-');
                targets.push({
                    kind: 'service',
                    id: consumed.targetId
                });
            }
        } else {
            this._definition = null;
            this._nativePeers = {};
            this._consumed = {};
            this._provided = {};
            this._clusterProvided = {};
            this._policies = {};
            this._consumedMeta = [];
        }

        targets = _.uniqBy(targets, x => x.kind + '-' + x.id);
        this.relationStore.replaceSource('service', this.id, targets);

        this._rebuildPodEndpoints();
        this._invalidatePods();
        this._invalidateBerliozMetadata();
        this._invalidateClusterEndpoints();
    }

    _rebuildPodEndpoints()
    {
        this.logger.info('[_rebuildPodEndpoints] %s...', this.id);
        for(var pod of _.values(this._pods))
        {
            pod.buildEndpoints();
        }
    }

    handleConsumer(isPresent, providerSvcId)
    {
        this.logger.info("[%s :: %s] handleConsumer :: %s :: %s", this.deploymentName, this.id, isPresent, providerSvcId)
        if (isPresent) {
            var handler = this._consumerHandlers[providerSvcId];
            if (handler) {
                return;
            }
            var handler = this.invalidator.handle('consumers', providerSvcId, this._rebuildConsumed.bind(this));
            this._consumerHandlers[providerSvcId] = handler;
            this.registerHandler(handler);
        } else {
            var handler = this._consumerHandlers[providerSvcId];
            if (handler) {
                delete this._consumerHandlers[providerSvcId];
                this.unregisterHandler(handler);
                handler.stop();
            }
        }
    }

    _addPod(podData)
    {
        var pod = this._parsePod(podData);
        this.logger.info('[_addPod] %s. %s :: %s, node: %s, status: %s.', this.id, pod.id, pod.identity, pod.node, pod.status);

        if (pod.isPresent)
        {
            if (pod.identity) {
                this._pods[pod.identity] = pod;
            }

            if (_.isNotNullOrUndefined(pod.node)) {
                this.infra.addPod(pod);
            }
        }
        else
        {
            if (pod.identity) {
                delete this._pods[pod.identity];
            }
            this.infra.removePod(pod.id);
        }

        this._invalidatePods();
    }

    _removePod(podData)
    {
        var pod = this._parsePod(podData);
        this.logger.info('[_removePod] %s. %s :: %s, node: %s, status: %s.', this.id, pod.id, pod.identity, pod.node, pod.status);

        if (pod.identity) {
            delete this._pods[pod.identity];
        }
        this.infra.removePod(pod.id);

        this._invalidatePods();
    }

    _rebuildPods()
    {
        if (!this._definition) {
            return;
        }

        this.logger.info("[_rebuildPods] %s...", this.id);

        this._providedPeerData = {};
        this._providedPeerDataByNode = {};
        for(var providedName of _.keys(this._provided))
        {
            var providedMeta = this._provided[providedName];
            this._providedPeerData[providedName] = {};
            this._providedPeerDataByNode[providedName] = {};

            for(var pod of _.values(this._pods))
            {
                this.logger.info("[_rebuildPods] %s, provided: %s, pod: %s...", 
                    this.id,
                    providedName,
                    pod.name);

                var portInfo = pod.endpoints[providedName]
                if (portInfo)
                {
                    this._providedPeerData[providedName][pod.identity] = portInfo;

                    if (!this._providedPeerDataByNode[providedName][pod.node]) {
                        this._providedPeerDataByNode[providedName][pod.node] = {}
                    }
                    this._providedPeerDataByNode[providedName][pod.node][pod.identity] = portInfo;
                }
            }
        }

        this.logger.info("[_rebuildPods] %s, provided peers: ", this.id, this._providedPeerData);
        this.logger.info("[_rebuildPods] %s, provided peers by node: ", this.id, this._providedPeerDataByNode);

        this.parent.invalidateConsumers(this.id);
        this.parent.invalidateConsumers(this.clusterId);
    }

    getProvidedPeerData(providedName)
    {
        if (providedName in this._providedPeerData) {
            return this._providedPeerData[providedName]; // TODO: maybe clone?
        }
        return {};
    }

    getProvidedPeerDataByNode(providedName)
    {
        if (providedName in this._providedPeerDataByNode) {
            return this._providedPeerDataByNode[providedName]; // TODO: maybe clone?
        }
        return {};
    }

    _parsePod(podData)
    {
        var pod = new Pod(this.logger, this, podData);
        return pod;
    }

    _rebuildConsumed()
    {
        if (!this._definition) {
            return;
        }
        this.logger.info("[_rebuildConsumed] %s...", this.id);

        this._consumedPeersData = {};
        for(var consumed of _.values(this._consumed)) {
            this.logger.info("[_rebuildConsumed] %s, consumed meta:", this.id, consumed);
            var providedPeers = this._getPeersForConsumed(consumed);
            if (providedPeers) {
                this._consumedPeersData[consumed.key] = providedPeers;
            }
        }

        this.logger.info("[_rebuildConsumed] %s, consumed peers: ", this.id, this._consumedPeersData);
        this._invalidateBerliozMetadata();
    }

    _getPeersForConsumed(consumed)
    {
        this.logger.info("[_getPeersForConsumed] %s to: ", this.id, consumed);

        var mappedConsumed = this._mapConsumed(consumed);
        if (!mappedConsumed) {
            this.logger.info("[_getPeersForConsumed] %s to %s could not map.", this.id, consumed.key);
            return null;
        }

        this.logger.info("[_getPeersForConsumed] %s to %s, mappedConsumed: ", this.id, consumed.key, mappedConsumed);

        var svc = this.parent.getService(mappedConsumed.serviceId);
        if (!svc) {
            this.logger.info("[_getPeersForConsumed] %s to %s no service found.", this.id, consumed.key);
            return null;
        }

        var providedPeers = {};
        if (consumed.isolation == 'instance') {
            providedPeers = svc.getProvidedPeerDataByNode(mappedConsumed.endpoint);
        } else {
            providedPeers = svc.getProvidedPeerData(mappedConsumed.endpoint);
        }
        return providedPeers;
    }

    _mapConsumed(consumed)
    {
        if (consumed.targetId.startsWith('cluster://')) {
            return this.parent.getClusterProvidedMapping(consumed);
        }
        return {
            serviceId: consumed.targetId,
            endpoint: consumed.endpoint
        }
    }

    _rebuildMetadata()
    {
        if (!this._definition) {
            return;
        }
        this.logger.info("[_rebuildMetadata] %s...", this.id);

        for(var pod of _.values(this._pods))
        {
            pod.invalidateMetadata();
        }
    }

    invalidatePodMetadata(podId)
    {
        this.logger.info("[invalidatePodMetadata] %s :: %s...", this.id, podId);
        this._podInvalidator.invalidate('pod', podId);
    }

    _onPodMetadataChanged(podId)
    {
        this.logger.info("[_onPodMetadataChanged] %s :: %s...", this.id, podId);
        var pod = this.infra.getPod(podId);
        if (!pod) {
            return;
        }
        return this._publishPodMetadata(pod);
    }

    _publishPodMetadata(pod)
    {
        this.logger.info("[_publishMetadata] %s...", this.id, pod.id);

        var taskMeta = {
            endpoints: pod.endpoints
        }

        taskMeta.policies = this._policies;

        taskMeta.consumes = this._consumedMeta;

        taskMeta.peers = {};
        for(var consumed of _.values(this._consumed)) {
            var consumedPeerMap = this._consumedPeersData[consumed.key];

            var finalPeersMap = {};
            if (consumedPeerMap) {
                if (consumed.isolation == 'instance') {
                    if (pod.node in consumedPeerMap) {
                        finalPeersMap = consumedPeerMap[pod.node];
                    }
                } else {
                    finalPeersMap = consumedPeerMap;
                }
            }

            taskMeta.peers[consumed.key] = finalPeersMap;
        }

        for(var x of _.keys(this._nativePeers))
        {
            taskMeta.peers[x] = this._nativePeers[x];
        }

        var taskMessage = {
            id: pod.id,
            metadata: taskMeta
        }

        var agentPod = this.infra.getPodAgentPod(pod);
        if (!agentPod) {
            // taskMessage.agentPod = agentPod.name;
            return;
        }

        var options = {
            method: 'POST',
            uri: 'http://' + agentPod.address + ':' + '55555' + '/report',
            body: [taskMessage],
            json: true
        };

        this.logger.info("[_publishMetadata] %s :: %s. Sending: ", this.id, pod.name, options);
        return request(options)
            .then(result =>  {
                this._logger.info('[_publishMetadata] %s :: %s. Completed.');
            })
            .catch(reason => {
                this._logger.error('[_publishMetadata] %s :: %s. Failed.', reason);
            });
    }

    _invalidatePods()
    {
        this.logger.debug("MARK PODS CHANGED for service: %s...", this.id);
        this.invalidator.invalidate('pods', this.id);
    }

    _invalidateBerliozMetadata()
    {
        this.logger.debug("MARK BERLIOZ METADATA CHANGED for service: %s...", this.id);
        this.invalidator.invalidate('metadata', this.id);
    }

    _invalidateClusterEndpoints()
    {
        this.logger.debug("MARK CLUSTER PROVIDED CHANGED for service: %s...", this.id);
        this.invalidator.invalidate('cluster-provided', this.clusterId);
    }
}

module.exports = Service;