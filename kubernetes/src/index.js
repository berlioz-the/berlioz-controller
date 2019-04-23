var logger = require('the-logger').setup('berlioz-controller',
    {
        enableFile: false,
        pretty: true
    });
logger.level = 'info';

logger.info("Starting...");
logger.info("ENVIRONMENT: ", process.env);

const KubernetesConnector = require('./lib/kubernetes-connector');
return Promise.resolve(KubernetesConnector(logger.sublogger('Client')))
    .then(k8sClient => {
        const Controller = require('./lib/controller');
        var controller = new Controller(logger.sublogger('Controller'), k8sClient);
        return controller.run();
    })
    .then(result => {
        logger.info('FINAL RESULT: ', result);
    })
    .catch(reason => {
        logger.error("FAILED: ");
        logger.error(reason);
    });