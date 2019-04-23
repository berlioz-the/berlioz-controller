const base64 = require('base-64');

function connectToRemote(logger) {
    var credentials = JSON.parse(base64.decode(process.env.BERLIOZ_GCP_CREDENTIALS));

    const GcpSdkClient = require('berlioz-gcp-sdk');
    var gcpClient = new GcpSdkClient(logger, process.env.BERLIOZ_GCP_ZONE, credentials);

    return gcpClient.Container.queryCluster(process.env.BERLIOZ_GCP_CLUSTER)
        .then(cluster => {
            return gcpClient.Container.connectToRemoteKubernetes(cluster);
        });
}

function connectToLocal(logger) {
    const KubernetesClient = require('berlioz-gcp-sdk/lib/kubernetes-client');
    var client = KubernetesClient.connectFromPod(logger.sublogger("k8s"));
    return client;
}

module.exports = function (logger) {
    if (process.env.BERLIOZ_GCP_CREDENTIALS) {
        return connectToRemote(logger);
    }

    if (process.env.KUBERNETES_PORT) {
        return connectToLocal(logger);
    }

    throw new Error('Dont know how to connect');
}