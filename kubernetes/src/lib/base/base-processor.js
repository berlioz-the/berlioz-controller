const _ = require('lodash');

class BaseProcessor
{
    constructor(logger, parent)
    {
        this._logger = logger;
        this._parent = parent;
        this._children = [];
        this._relationStore = null;
        this._invalidator = null;
        if (parent) {
            if (parent.relationStore) {
                this._relationStore = parent.relationStore;
            }
            if (parent.invalidator) {
                this._invalidator = parent.invalidator;
            }
            if (parent._children) {
                parent._children.push(this);
                parent._handleChildAdd(this.constructor.name, this);
            }
        }
        this._handlers = {};
    }

    get logger() {
        return this._logger;
    }

    get parent() {
        return this._parent;
    }

    get relationStore() {
        return this._relationStore;
    }

    get invalidator() {
        return this._invalidator;
    }

    registerHandler(handler)
    {
        this._handlers[handler._id] = handler;
    }

    unregisterHandler(handler)
    {
        delete this._handlers[handler._id];
    }

    destroy()
    {
        this._stopHandlers();

        if (this._parent) {
            if (this._parent._children) {
                _.pull(this._parent._children, this);
                this._parent._handleChildRemove(this.constructor.name, this);
            }
        }
    }

    _stopHandlers()
    {
        for(var x of _.values(this._handlers)) {
            x.stop();
        }
        this._handlers = {};
    }

    // Can be overridden
    _handleChildAdd(childName, childObj)
    {

    }

    // Can be overridden
    _handleChildRemove(childName, childObj)
    {

    }
}

module.exports = BaseProcessor;