const _ = require('the-lodash');
const Promise = require('the-promise');

const BaseProcessor = require('./base/base-processor');
const RelationStore = require('./base/relation-store');
const Invalidator = require('./base/invalidator');

class Infra extends BaseProcessor {
    constructor(logger) {
        super(logger, null);

        this._relationStore = new RelationStore(logger.sublogger("InfraRelationStore"));
        this._invalidator = new Invalidator(logger.sublogger("InfraInvalidator"));
        this._agentRelationStore = new RelationStore(logger.sublogger("InfraAgentRelationStore"));

        this._pods = {};
        this._podToNodeMap = {};
        this._nodesToPods = {};

        this.registerHandler(this.relationStore.monitor('pod', 'node', this._onPodToNodeChanged.bind(this)));
        this.registerHandler(this.invalidator.handleAll('node-agent', this._onNodeAgentsChanged.bind(this)));
        this.registerHandler(this._agentRelationStore.monitor('node', 'agent-pod', this._onNodeActiveAgentChanged.bind(this)));
    }

    getPod(podId) {
        if (podId in this._pods) {
            return this._pods[podId];
        }
        return null;
    }

    addPod(pod) {
        var nodeId = pod.node;
        this.logger.info('[addPod] %s, name: %s, node: %s', pod.id, pod.name, nodeId);

        this._pods[pod.id] = pod;

        var targets = [{
            kind: 'node',
            id: nodeId
        }]

        if (pod.isBerliozAgent) {
            targets.push({
                kind: 'node-agent',
                id: nodeId
            });
            this.invalidator.invalidate('node-agent', nodeId);
        }

        this.relationStore.replaceSource('pod', pod.id, targets);
    }

    removePod(podId) {
        this.logger.info('[removePod] %s', podId);
        delete this._pods[podId];

        this.relationStore.removeSource('pod', podId);
    }

    getPodAgentPod(pod) {
        return this.getNodeAgentPod(pod.node);
    }

    getNodeAgentPod(nodeId) {
        var podIds = this._agentRelationStore.getTargetIdsByKind('node', nodeId, 'agent-pod');
        var podId = _.head(podIds);
        if (podId) {
            return this.getPod(podId);
        }
        return null;
    }

    _onPodToNodeChanged(isPresent, srcKind, srcId, targetKind, targetId) {
        this.logger.info('Pod => Node. IsPresent: %s, %s => %s.', isPresent, srcId, targetId);
        if (isPresent) {
            var pod = this.getPod(srcId);
            if (!pod) {
                return;
            }
            pod.invalidateMetadata();
        }
    }

    _onNodeAgentsChanged(nodeId) {
        this.logger.info('[_onNodeAgentsChanged] %s', nodeId);

        var agentPodIds = this.relationStore.getSourceIdsByKind('node-agent', nodeId, 'pod');
        this.logger.info('[_onNodeAgentsChanged] %s AgentPod IDs: ', nodeId, agentPodIds);

        var agentPods = agentPodIds.map(x => this._pods[x]);
        agentPods = agentPods.filter(x => _.isNotNullOrUndefined(x));
        agentPods = agentPods.filter(x => x.isPresent);
        var agentPod = _.head(agentPods);

        var targets = []
        if (agentPod) {
            targets.push({
                kind: 'agent-pod',
                id: agentPod.id
            });
        }
        this._agentRelationStore.replaceSource('node', nodeId, targets);
    }

    _onNodeActiveAgentChanged(isPresent, srcKind, srcId, targetKind, targetId) {
        this.logger.info('[_onNodeActiveAgentChanged] Node => ActiveAgent. IsPresent: %s, %s => %s.', isPresent, srcId, targetId);

        var podIds = this.relationStore.getSourceIdsByKind('node', srcId, 'pod');
        // this.logger.info('[_onNodeActiveAgentChanged] Node %s, pods: %s', srcId, podIds);
        for (var podId of podIds) {
            var pod = this.getPod(podId);
            if (pod) {
                pod.invalidateMetadata();
            }
        }
    }
}

module.exports = Infra;