const _ = require('lodash');
const uuid = require('uuid/v4');

class RelationStore
{
    constructor(logger)
    {
        this._logger = logger;
        this._relations = {}; 
        this._inverseRelations = {}; 
        this._srcSubscribers = {};
        this._targetSubscribers = {};
        this._srcTargetSubscribers = {};
        this._handlerIdMap = {};
    }

    get logger() {
        return this._logger;
    }

    monitor(srcKind, targetKind, cb)
    {
        var kind = srcKind + '-' + targetKind;
        return this._makeSubscriber(this._srcTargetSubscribers, kind, cb) 
    }

    monitorSrc(srcKind, cb)
    {
        return this._makeSubscriber(this._srcSubscribers, srcKind, cb) 
    }

    monitorTarget(targetKind, cb)
    {
        return this._makeSubscriber(this._targetSubscribers, targetKind, cb) 
    }

    _makeSubscriber(dict, kind, cb) 
    {
        var info = this._newHandler();
        info._dict = dict;
        info._kind = kind;
        info._cb = cb;

        if (!(kind in dict)) {
            dict[kind] = {};
        }
        dict[kind][info._id] = info;

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

        delete info._dict[info._kind][info._id];
        
        if (_.keys(info._dict[info._kind]).length == 0) {
            delete info._dict[info._kind];
        }
        
        delete this._handlerIdMap[id];
    }

    _notifyToSubscribers(isPresent, srcKind, srcId, targetKind, targetId)
    {
        var subscribers = [];
        subscribers = _.concat(subscribers, this._getSubscribers(this._srcSubscribers, srcKind));
        subscribers = _.concat(subscribers, this._getSubscribers(this._targetSubscribers, targetKind));
        subscribers = _.concat(subscribers, this._getSubscribers(this._srcTargetSubscribers, srcKind + '-' + targetKind));

        for(var cb of subscribers) {
            cb(isPresent, srcKind, srcId, targetKind, targetId);
        }
    }

    _getSubscribers(dict, kind) 
    {
        if (kind in dict) {
            return _.values(dict[kind]).map(x => x._cb);
        }
        return [];
    }

    add(srcKind, srcId, targetKind, targetId)
    {   
        var isChanged = this._rawAddToDict(this._relations, srcKind, srcId, targetKind, targetId);
        if (isChanged) {
            this._rawAddToDict(this._inverseRelations, targetKind, targetId, srcKind, srcId)
            this._notifyToSubscribers(true, srcKind, srcId, targetKind, targetId);
        }
    }

    remove(srcKind, srcId, targetKind, targetId)
    {
        var isChanged = this._rawRemoveFromDict(this._relations, srcKind, srcId, targetKind, targetId);
        if (isChanged) {
            this._rawRemoveFromDict(this._inverseRelations, targetKind, targetId, srcKind, srcId);
            this._notifyToSubscribers(false, srcKind, srcId, targetKind, targetId);
        }
    }

    getTargetIdsByKind(srcKind, srcId, targetKind)
    {
        return this._rawGetTargetIdsByKind(this._relations, srcKind, srcId, targetKind);
    }

    getAllTargets(srcKind, srcId)
    {
        return this._rawGetAllTargets(this._relations, srcKind, srcId);
    }

    getSourceIdsByKind(targetKind, targetId, srcKind)
    {
        return this._rawGetTargetIdsByKind(this._inverseRelations, targetKind, targetId, srcKind);
    }

    getAllSources(targetKind, targetId)
    {
        return this._rawGetAllTargets(this._inverseRelations, targetKind, targetId);
    }

    removeSource(srcKind, srcId)
    {
        return this.replaceSource(srcKind, srcId, []);
    }

    replaceSource(srcKind, srcId, targets)
    {
        var currTargets = this.getAllTargets(srcKind, srcId);
        currTargets = this._makeTargetDict(currTargets);
        targets = this._makeTargetDict(targets);
        
        var diff = this._makeDiff(currTargets, targets);
        for(var delta of diff)
        {
            if (delta.isCreated) {
                this.add(srcKind, srcId, delta.obj.kind, delta.obj.id);
            } else {
                this.remove(srcKind, srcId, delta.obj.kind, delta.obj.id);
            }
        }
    }

    debugOutput()
    {
        this._logger.info("DUMP RELATIONS: ", this._relations);
        this._logger.info("DUMP INVERSE RELATIONS: ", this._inverseRelations);
    }

    _makeTargetDict(targets)
    {
        return _.makeDict(targets, x => _.stableStringify(x));
    }

    _makeDiff(currTargets, desiredTargets)
    {
        var delta = [];
        for(var id of _.keys(currTargets)) {
            if (!(id in desiredTargets)) {
                delta.push({
                    isCreated: false,
                    obj: currTargets[id]
                });
            }
        }
        for(var id of _.keys(desiredTargets)) {
            if (!(id in currTargets)) {
                delta.push({
                    isCreated: true,
                    obj: desiredTargets[id]
                });
            }
        }
        return delta;
    }

    _rawAddToDict(rootDict, srcKind, srcId, targetKind, targetId)
    {   
        if (!(srcKind in rootDict)) {
            rootDict[srcKind] = {};
        }

        if (!(srcId in rootDict[srcKind])) {
            rootDict[srcKind][srcId] = {};
        }
        
        var srcDict = rootDict[srcKind][srcId];

        if (!(targetKind in srcDict)) {
            srcDict[targetKind] = {};
        }

        if (srcDict[targetKind][targetId] == true) {
            return false
        }

        srcDict[targetKind][targetId] = true;
        return true;
    }

    _rawRemoveFromDict(rootDict, srcKind, srcId, targetKind, targetId)
    {
        if (!(srcKind in rootDict)) {
            return false;
        }
        if (!(srcId in rootDict[srcKind])) {
            return false;
        }
        if (!(targetKind in rootDict[srcKind][srcId])) {
            return false;
        }
        if (!(targetId in rootDict[srcKind][srcId][targetKind])) {
            return false;
        }

        delete rootDict[srcKind][srcId][targetKind][targetId];

        if (_.keys(rootDict[srcKind][srcId][targetKind]).length == 0) {
            delete rootDict[srcKind][srcId][targetKind];
        }
        if (_.keys(rootDict[srcKind][srcId]).length == 0) {
            delete rootDict[srcKind][srcId];
        }
        if (_.keys(rootDict[srcKind]).length == 0) {
            delete rootDict[srcKind];
        }

        return true;
    }

    _rawGetTargetIdsByKind(rootDict, srcKind, srcId, targetKind)
    {
        if (!(srcKind in rootDict)) {
            return [];
        }
        if (!(srcId in rootDict[srcKind])) {
            return [];
        }

        if (!(targetKind in rootDict[srcKind][srcId])) {
            return [];
        }

        var targets = [];
        for(var id of _.keys(rootDict[srcKind][srcId][targetKind])) {
            targets.push(id);
        }
        return targets;
    }

    _rawGetAllTargets(rootDict, srcKind, srcId)
    {
        if (!(srcKind in rootDict)) {
            return [];
        }
        if (!(srcId in rootDict[srcKind])) {
            return [];
        }

        var targets = [];
        for(var kind of _.keys(rootDict[srcKind][srcId])) {
            for(var id of _.keys(rootDict[srcKind][srcId][kind])) {
                targets.push({
                    kind: kind,
                    id: id
                });
            }
        }
        return targets;
    }

}


module.exports = RelationStore;