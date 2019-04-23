const _ = require('the-lodash');
const Promise = require('the-promise');

const Deployment = require('./deployment');
const Infra = require('./infra');

class Controller
{
    constructor(logger, k8sClient)
    {
        this._logger = logger;
        this._k8sClient = k8sClient; 
        this._infra = new Infra(this.logger.sublogger("Infra"));
        this._deployments = {};
        this._commonDeployment = new Deployment(this.logger.sublogger('Deployment'), null, true, this._infra, this);
    }

    get logger() {
        return this._logger;
    }

    get k8sClient() {
        return this._k8sClient;
    }

    get commonDeployment() {
        return this._commonDeployment;
    }

    get deployments() {
        return _.values(this._deployments);
    }

    run()
    {
        this._monitorPods();    
        this._monitorBerliozServices();
    }

    _monitorPods()
    {
        return this.k8sClient.Pod.watchAll(null, (action, pod) => {
            this.logger.silly("[_monitorPods] %s", action, pod)

            if (!this._isInterestedPod(pod)) {
                return;
            }

            this.logger.verbose("[_monitorPods] %s :: %s => %s", action, pod.metadata.name, pod.status.phase, pod)

            var deployment = this._fetchDeployment(pod.metadata.labels.deployment);
            deployment.handlePod(this._parseAction(action), pod);
        });
    }

    _monitorBerliozServices()
    {
        return this.k8sClient.BerliozService.watchAll(null, (action, svc) => {
            if (!svc) {
                return;
            }

            this.logger.verbose("[_monitorBerliozServices] %s :: %s => ", action, svc.metadata.name, svc)
            var deployment = this._fetchDeployment(svc.metadata.labels.deployment);
            deployment.handleBerliozService(this._parseAction(action), svc);
        });
    }

    _fetchDeployment(name)
    {
        if (!name) {
            return this._commonDeployment;
        }
        if (name in this._deployments) {
            return this._deployments[name];
        }
        var deployment = new Deployment(this.logger.sublogger('Deployment'), name, false, this._infra, this);
        this._deployments[name] = deployment;
        return deployment;
    }

    _isInterestedPod(pod)
    {
        if (!pod) {
            return false;
        }
        if (!pod.metadata.labels) {
            return false;
        }    
        if (pod.metadata.labels.berlioz_managed != 'true') {
            return false;
        }    
        return true;
    }

    _parseAction(action)
    {
        if (action == 'ADDED' || action == 'MODIFIED') {
            return true;
        }
        if (action == 'DELETED') {
            return false;
        }
        return false;
    }
}

module.exports = Controller;