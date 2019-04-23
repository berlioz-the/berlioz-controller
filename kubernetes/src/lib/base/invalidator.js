const _ = require('the-lodash');
const Promise = require('the-promise');
const uuid = require('uuid/v4');

class Invalidator
{
    constructor(logger)
    {
        this._logger = logger;
        this._repo = {};
        this._handlerIdMap = {};
        this._handlersGlobal = {};
        this._handlersLocal = {};
    }

    get logger() {
        return this._logger;
    }

    invalidate(kind, id)
    {
        var items = this._getItemMap(kind);
        if (!(id in items)) {
            items[id] = {
                revision: 0,
                currentRevision: 0
            }
        }
        
        items[id].revision = items[id].revision + 1;

        this._checkProcess(kind, id);
    }

    _checkProcess(kind, id)
    {
        this.logger.silly('[_checkProcess] %s :: %s', kind, id);

        var items = this._getItemMap(kind);
        if (!items[id]) {
            return;
        }
        if (items[id].revision == items[id].currentRevision) {
            delete items[id];
            return;
        }
        if (items[id].isTriggered) {
            return;
        }
        items[id].isTriggered = true;

        return Promise.timeout(1000)
            .then(() => this._processHandlers(kind, id));
    }

    _processHandlers(kind, id)
    {
        this.logger.silly('[_processHandlers] %s :: %s', kind, id);

        var items = this._getItemMap(kind);
        var revision = items[id].revision
        
        Promise.resolve()
            .then(() => {
                var handlers = this._getMyHandlers(kind, id);
                return Promise.serial(handlers, cb => this._processHandler(kind, id, cb));
            })
            .then(() => {
                this.logger.silly('[_processHandlers] Finish. %s :: %s', kind, id);
                items[id].isTriggered = false;
                items[id].currentRevision = revision;
                return this._checkProcess(kind, id);
            })
            .catch(reason => {
                this.logger.error('[_processHandlers] Finish. %s :: %s', kind, id, reason);
                items[id].isTriggered = false;
                return this._checkProcess(kind, id);
            });
    }

    _processHandler(kind, id, cb)
    {
        this.logger.silly('[_processHandler] %s :: %s', kind, id);
        return cb(id);
    }


    _getMyHandlers(kind, id)
    {
        var handlers = [];
        if (kind in this._handlersGlobal) {
            handlers = _.concat(handlers, _.values(this._handlersGlobal[kind]).map(x => x._cb));
        }
        if (kind in this._handlersLocal) {
            if (id in this._handlersLocal[kind]) {
                handlers = _.concat(handlers, _.values(this._handlersLocal[kind][id]).map(x => x._cb));
            }
        }
        return handlers;
    }

    handleAll(kind, cb)
    {
        var info = this._newHandler();
        info._kind = kind;
        info._isGlobal = true
        info._cb = cb;
        if (!(kind in this._handlersGlobal)) {
            this._handlersGlobal[kind] = {};
        }
        this._handlersGlobal[kind][info._id] = info;

        var items = this._getItemMap(kind);
        for(var id of _.keys(items)) 
        {
            this.invalidate(kind, id);
        }

        return info;
    }

    handle(kind, id, cb)
    {
        var info = this._newHandler();
        info._kind = kind;
        info._isGlobal = false;
        info._target = id;
        info._cb = cb;
        if (!(kind in this._handlersLocal)) {
            this._handlersLocal[kind] = {};
        }
        if (!(id in this._handlersLocal[kind])) {
            this._handlersLocal[kind][id] = {};
        }
        this._handlersLocal[kind][id][info._id] = info;
        // this._logger.info('%s::%s local handler count: %s ', kind, id, _.keys(this._handlersLocal[kind][id]).length);

        this.invalidate(kind, id);
        return info;
    }

    _newHandler() {
        var id = this._makeId();
        var info = {
            _id: id,
            stop: () => {
                this._stopHandler(id);
            }
        };
        this._handlerIdMap[info._id] = info;
        return info;
    }

    _makeId()
    {
        var id = uuid();
        if (id in this._handlerIdMap) {
            return this._makeId();
        }
        return id;
    }

    _stopHandler(id)
    {
        if (!(id in this._handlerIdMap)) {
            return;
        }

        var info = this._handlerIdMap[id];

        if (info._isGlobal) {
            delete this._handlersGlobal[info._kind][info._id];

            if (_.keys(this._handlersGlobal[info._kind]).length == 0) {
                delete this._handlersGlobal[info._kind];
            }
        } else {
            delete this._handlersLocal[info._kind][info._target][info._id];

            if (_.keys(this._handlersLocal[info._kind][info._target]).length == 0) {
                delete this._handlersLocal[info._kind][info._target];
            }

            if (_.keys(this._handlersLocal[info._kind]).length == 0) {
                delete this._handlersLocal[info._kind];
            }
        }

        delete this._handlerIdMap[id];
    }

    _getItemMap(kind)
    {
        if (!(kind in this._repo)) {
            this._repo[kind] = {};
        }
        return this._repo[kind];
    }

}

module.exports = Invalidator;