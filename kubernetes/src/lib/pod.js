const _ = require('the-lodash');
const Promise = require('the-promise');

const identityExtractor = require('berlioz-identity-extractor');

class Pod
{
    constructor(logger, service, pod)
    {
        this._logger = logger;
        this._parent = service;
        this._podData = pod;

        this._id = pod.metadata.uid;
        this._name = pod.metadata.name;
        this._node = pod.spec.nodeName;
        this._status = pod.status.phase;
        this._address = pod.status.podIP;
        this._servicePodName = pod.metadata.labels.name;

        this._isBerliozAgent = (
            (pod.metadata.labels['cluster'] == 'berlioz') && 
            (pod.metadata.labels['sector'] == 'main') && 
            (pod.metadata.labels['service'] == 'agent')
            );
        this._identity = this._extractPodIdentity(pod);
        
        this.logger.info('[Pod] constructor. name: %s, id: %s => %s. %s. node: %s. isPresent: %s. isAgent: %s.', 
            this.name,
            this.id,
            this.identity,
            this.status,
            this.node,
            this.isPresent,
            this.isBerliozAgent);

        this._endpoints = {};
        this.buildEndpoints();
    }

    get logger() {
        return this._logger;
    }

    get parent() {
        return this._parent;
    }

    get serviceId() {
        return this.parent.id;
    }

    get deploymentName() {
        return this.parent.deploymentName;
    }

    get id() {
        return this._id;
    }

    get name() {
        return this._name;
    }

    get identity() {
        return this._identity;
    }
    
    get address() {
        return this._address;
    }

    get endpoints() {
        return this._endpoints;
    }
    
    get node() {
        return this._node;
    }
    
    get status() {
        return this._status;
    }

    get isPresent() {
        return (this.status == 'Running') &&
            _.isNotNullOrUndefined(this.node) &&
            _.isNotNullOrUndefined(this.identity);
    }

    get isBerliozAgent() {
        return this._isBerliozAgent;
    }

    invalidateMetadata()
    {
        if (this.isBerliozAgent) {
            return;
        }
        this.parent.invalidatePodMetadata(this.id);
    }

    _extractPodIdentity(pod)
    {
        var podEnv = {}

        var mainContainer = _.head(pod.spec.containers.filter(x => x.name == this._servicePodName));
        if (!mainContainer) {
            return null;
        }
        for(var x of mainContainer.env) {
            if (_.isNotNullOrUndefined(x.value)) {
                podEnv[x.name] = x.value; 
            } else {
                if(x.valueFrom) {
                    if (x.valueFrom.fieldRef) {
                        if (x.valueFrom.fieldRef.fieldPath == 'metadata.name') {
                            podEnv[x.name] = pod.metadata.name; 
                        }
                    }
                }
            }
        }

        // this.logger.info("[_extractPodIdentity] POD %s ENV: ", this.id, podEnv);
        return identityExtractor.extract(podEnv);
    }

    buildEndpoints()
    {
        var podEndpoints = {};

        for(var container of this._podData.spec.containers)
        {
            if (!container.ports) {
                continue;
            }
            for(var portInfo of container.ports)
            {
                if (portInfo.name)
                {
                    var portMeta = this.parent.getProvidedMeta(portInfo.name);
                    if (portMeta) {
                        podEndpoints[portInfo.name] = {
                            name: portInfo.name,
                            protocol: portMeta.protocol,
                            networkProtocol: portMeta.networkProtocol,
                            port: portInfo.containerPort, // TODO: container/host port?
                            address: this.address
                        };
                    } else {
                    //     this.logger.error("[Pod] Provided Metadata for %s is null. PortName: %s. Service: %s", 
                    //         this.name,
                    //         portInfo.name,
                    //         this.parent.id);
                    }
                }
            }
        }

        var isSame = _.fastDeepEqual(this._endpoints, podEndpoints);
        this._endpoints = podEndpoints;
        if (!isSame) {
            this.invalidateMetadata();
        }

        this.logger.info('[Pod] buildEndpoints. name: %s, endpoints: ', 
            this.name,
            this.endpoints);
    }


}

module.exports = Pod;