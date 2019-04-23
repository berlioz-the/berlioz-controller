const _ = require('the-lodash');
const BaseProcessor = require('./base/base-processor');
const RelationStore = require('./base/relation-store');
const Invalidator = require('./base/invalidator');

const Cluster = require('./cluster');
const Service = require('./service');

class Deployment extends BaseProcessor
{
    constructor(logger, name, isCommon, infra, controller)
    {
        super(logger, null);

        this._name = name; 
        this._isCommon = isCommon;
        this._infra = infra;
        this._controller = controller;

        this._relationStore = new RelationStore(logger.sublogger("RelationStore"));
        this._invalidator = new Invalidator(logger.sublogger("Invalidator"));
        this._services = {};
        this._clusterServices = {};
        this._clusters = {};

        this.registerHandler(this.relationStore.monitor('service', 'service', this._onServiceConsumersChanged.bind(this)));
        this.registerHandler(this.relationStore.monitor('cluster', 'service', this._onClusterToServiceMappingChanged.bind(this)));
    }

    get name() {
        return this._name;
    }

    get isCommon() {
        return this._isCommon;
    }
    
    get infra() {
        return this._infra;
    }

    get services() {
        return _.values(this._services);
    }

    getClusterProvidedMapping(consumed)
    {
        this.logger.silly("[getClusterProvidedMapping] %s :: %s...", this.name, consumed.key, consumed.targetId);
        var cluster = this.getCluster(consumed.targetId);
        if (!cluster) {
            this.logger.silly("[getClusterProvidedMapping] %s :: %s. cluster %s not found.", this.name, consumed.key, consumed.targetId);
            return null;
        }
        return cluster.getClusterProvidedMapping(consumed.endpoint);
    }

    _handleChildAdd(childName, childObj)
    {
        this.logger.info("[%s] Child Processor Added: %s", this._name, childName);
    }

    _handleChildRemove(childName, childObj)
    {
        this.logger.info("[%s] Child Processor Removed: %s", this._name, childName);
    }

    handlePod(isPresent, pod)
    {
        this.logger.info("[%s] handlePod: %s :: %s => %s", this._name, isPresent, pod.metadata.name, pod.status.phase)

        var id = this._constructServiceId(pod);
        var service = this._fetchService(id);
        service.handlePod(isPresent, pod);
    }

    handleBerliozService(isPresent, svc)
    {
        this.logger.info("[%s] handleBerliozService: %s :: %s", this._name, isPresent, svc.metadata.name)

        var id = this._constructServiceId(svc);
        var service = this._fetchService(id);
        service.handleDefinition(isPresent, svc);
    }

    _onServiceConsumersChanged(isPresent, srcKind, srcId, targetKind, targetId)
    {
        this.logger.info('Consumer => Provider. IsPresent: %s, %s => %s.', isPresent, srcId, targetId);
        var service = this.getService(srcId);
        if (!service) {
            this.logger.error('SVC NOT PRESENT. Consumer => Provider. IsPresent: %s, %s => %s.', isPresent, srcId, targetId);
            return;
        }
        service.handleConsumer(isPresent, targetId);
    }

    _onClusterToServiceMappingChanged(isPresent, srcKind, srcId, targetKind, targetId)
    {
        this.logger.info('Cluster => Service. IsPresent: %s, %s => %s.', isPresent, srcId, targetId);
        var cluster = this.getCluster(srcId);
        if (!cluster) {
            this.logger.error('CLUSTER NOT PRESENT. Cluster => Service. IsPresent: %s, %s => %s.', isPresent, srcId, targetId);
            return;
        }
        cluster.handleServiceMapping(isPresent, targetId);
    }

    _fetchService(id)
    {
        if (id in this._services) {
            return this._services[id];
        }
        var service = new Service(this.logger.sublogger('Service'), this, id);
        this._services[id] = service;

        if (!(service.clusterId in this._clusters)) {
            var cluster = new Cluster(this.logger.sublogger('Cluster'), this, service.clusterId);
            this._clusters[service.clusterId] = cluster;
        }

        if (!(service.clusterId in this._clusterServices)) {
            this._clusterServices[service.clusterId] = {};
        }
        this._clusterServices[service.clusterId][id] = service;

        return service;
    }

    getService(id)
    {
        if (id in this._services) {
            return this._services[id];
        }
        if (!this.isCommon) {
            return this._controller.commonDeployment.getService(id);
        }
        return null;
    }

    getCluster(id)
    {
        if (id in this._clusters) {
            return this._clusters[id];
        }
        if (!this.isCommon) {
            return this._controller.commonDeployment.getCluster(id);
        }
        return null;
    }

    getClusterServices(clusterId)
    {
        if (clusterId in this._clusterServices) {
            return _.values(this._clusterServices[clusterId]);
        }
        return [];
    }

    _constructServiceId(obj)
    {
        var id = 'service://' + [
            obj.metadata.labels.cluster, 
            obj.metadata.labels.sector, 
            obj.metadata.labels.service
        ].join('-');
        return id;
    }

    invalidateConsumers(serviceId)
    {
        this.logger.info("[invalidateConsumers] %s. MARK CONSUMERS CHANGED for: %s...", this.name, serviceId);
        this.invalidator.invalidate('consumers', serviceId);

        if (this.isCommon) {
            for(var otherDeployment of this._controller.deployments)
            {
                otherDeployment.invalidateConsumers(serviceId);
            }
        }
    }
}

module.exports = Deployment;