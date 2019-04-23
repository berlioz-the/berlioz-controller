const _ = require('the-lodash');
const Promise = require('the-promise');

const BaseProcessor = require('./base/base-processor');

class Cluster extends BaseProcessor
{
    constructor(logger, deployment, id)
    {
        super(logger, deployment)
        this._id = id; 

        this.logger.info("[Cluster-constructor] %s :: %s...", this.deploymentName, this.id);

        this._serviceProvidedMap = {};

        this._mappingHandlers = {};
        
        this.registerHandler(this.invalidator.handle('cluster-provided', this.id, this._rebuildClusterProvided.bind(this)));
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

    getClusterProvidedMapping(name)
    {
        this.logger.silly("[getClusterProvidedMapping] %s :: %s, endpoint: %s...", this.deploymentName, this.id, name);
        if (name in this._serviceProvidedMap) {
            return this._serviceProvidedMap[name];
        }
        return null;
    }

    _rebuildClusterProvided()
    {
        this.logger.info("[%s :: %s] _rebuildClusterProvided", this.deploymentName, this.id)

        var targets = [];
        this._serviceProvidedMap = {};

        var myServices = this.parent.getClusterServices(this.id);
        for(var service of myServices)
        {
            this.logger.info("[%s :: %s] _rebuildClusterProvided. %s...", this.deploymentName, this.id, service.id);

            var clusterProvides = service.getClusterProvided();
            this.logger.info("[%s :: %s] _rebuildClusterProvided. %s. ClusterProvides:", this.deploymentName, this.id, service.id, clusterProvides);

            for(var clusterProvidedName of _.keys(clusterProvides))
            {
                var clusterProvided = clusterProvides[clusterProvidedName];
                targets.push({
                    kind: 'service',
                    id: service.id
                });

                this._serviceProvidedMap[clusterProvidedName] = {
                    serviceId: service.id,
                    endpoint: clusterProvided.targetEndpoint
                };
            }
        }

        this.logger.info("[%s :: %s] _rebuildClusterProvided, targets: ", this.deploymentName, this.id, targets)
        this.logger.info("[%s :: %s] _rebuildClusterProvided, serviceProvidedMap: ", this.deploymentName, this.id, this._serviceProvidedMap)

        targets = _.uniqBy(targets, x => x.kind + '-' + x.id);
        this.relationStore.replaceSource('cluster', this.id, targets);
        this.relationStore.debugOutput();
    }

    handleServiceMapping(isPresent, serviceId)
    {
        this.logger.info("[%s :: %s] handleServiceMapping :: %s :: %s", this.deploymentName, this.id, isPresent, serviceId);
        this.parent.invalidateConsumers(this.id);
    }
}

module.exports = Cluster;