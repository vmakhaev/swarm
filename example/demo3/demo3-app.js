(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Syncable = require('../../../lib/Syncable');
var Model = require('../../../lib/Model');

// no "set" op
// special logix
// time slots and tracks are fixed
var Agenda = Syncable.extend('Agenda', {

    defaults: {
        _oplog: Object,
        agenda: Object
    },

    ops: {
        attend: function (spec,val,lstn) {
            // get author (strip ssn)

            // sometimes, the newly arrived op is already overwritten
            // by a preexisting concurrent op; let's detect that
            var myVer = '!' + spec.version();
            for(var oldSpec in this._oplog) {
                if (oldSpec>myVer) {
                    var oldVal = this._oplog[oldSpec];
                    if (oldVal.slot===val.slot)
                        return; // rewritten already
                }
            }
            this.agenda[val.slot] = val.track;
        }
    },

    // Purge overwritten operations.
    distillLog: function () {
        var slotMax = {};
        for(var spec in this._oplog) {
            var val = this._oplog[spec];
            var prevSpec = slotMax[val.slot];
            if (prevSpec) {
                if (spec>prevSpec) {
                    delete this._oplog[prevSpec];
                    slotMax[val.slot] = spec;
                } else {
                    delete this._oplog[spec];
                }
            } else {
                slotMax[val.slot] = spec;
            }
        }
    },

    // oplog-only diff
    diff: Model.prototype.diff

});

module.exports = Agenda;

// Well, this should be in the model too, but let's simplify a bit
Agenda.SLOTS = ['09:00','10:30','13:30','15:00'];
Agenda.TRACKS = ['Consistency','Availability','Partition tolerance'];
Agenda.PROGRAM = {
    'Consistency': {
        '09:00': {
            title:'The promise and perils of NewSQL',
            speakers:'N. Shamgunov'
        },
        '10:30': {
            title:'Scaling MySQL way beyond reasonable limits',
            speakers:''
        },
        '13:30': {
            title:'Spanner: megalomaniac like everything we do',
            speakers:'G.O.Ogler'
        },
        '15:00': {
            title:'Resolving the Great Papal Schism using pen and paper',
            speakers:'Martin V Colonna'
        }
    },
    'Availability': {
        '09:00': {
            title: 'Dead slaves',
            speakers: 'H. Beecher Stowe'
        },
        '10:30': {
            title:'Avoiding minority reports in Paxos',
            speakers:'Tom Cruise'
        },
        '13:30': {
            title:'RTT of 1 year: latency compensation in 16th cent. Spain',
            speakers:'Philip II of Spain'
        },
        '15:00': {
            title:'to be announced',
            speakers:''
        }
    },
    'Partition tolerance': {
        '09:00': {
            title:'Bow-wow hood.ie',
            speakers:'I.P. Pavlov'
        },
        '10:30': {
            title:'Maintaining offline-mode ATMs',
            speakers:'Elvis R. Rodriguez '
        },
        '13:30': {
            title:'Splitting worms for fun and profit',
            speakers:''
        },
        '15:00': {
            title:'CouchDB and me',
            speakers:'H. Simpson'
        }
    }
};

},{"../../../lib/Model":5,"../../../lib/Syncable":12}],2:[function(require,module,exports){
var Swarm = require('../../lib/Html5Client'); // bulk require()
var PostMessageStream = require('../../lib/PostMessageStream');
var Agenda = require('../conf/model/Agenda.js');

var app = window.app = {};

// don't need OAuth for a demo, gen fake user account
app.id = window.localStorage.getItem('.localuser') ||
    'anon'+Spec.int2base((Math.random()*10000)|0);
window.localStorage.setItem('.localuser',app.id);
app.wsServerUri = 'ws://'+window.location.host;
Swarm.env.debug = true;

app.host = Swarm.env.localhost = new Swarm.Host
    (app.id+'~local', 0, new Swarm.Storage(false));

PostMessageStream.listen(app.host);

app.agendaSpec = '/Agenda#'+app.id;
//app.agenda = new Agenda(app.agendaSpec);

app.host.connect(app.wsServerUri);

if (window.location.hostname==='localhost') {
    document.body.setAttribute('local','1');
}

},{"../../lib/Html5Client":4,"../../lib/PostMessageStream":7,"../conf/model/Agenda.js":1}],3:[function(require,module,exports){
var env = require('./env');
var Spec = require('./Spec');
var Syncable = require('./Syncable');
var Pipe = require('./Pipe');

/**
 * Host is (normally) a singleton object registering/coordinating
 * all the local Swarm objects, connecting them to appropriate
 * external uplinks, maintaining clocks, etc.
 * Host itself is not fully synchronized like a Model but still
 * does some event gossiping with peer Hosts.
 * @constructor
 */
function Host (id, val, storage) {
    this.objects = {};
    this.lastTs = '';
    this.tsSeq = 0;
    this.clockOffset = 0;
    this.sources = {};
    this.storage = storage;
    this._host = this; // :)
    this._lstn = [','];
    this._id = id;

    if (this.storage) {
        this.sources[this._id] = this.storage;
        this.storage._host = this;
    }
    delete this.objects[this.spec()];

    if (!env.multihost) {
        if (env.localhost) throw new Error('use multihost mode');
        env.localhost = this;
    }
}

var Host = Syncable.extend(Host, {

    deliver: function (spec, val, repl) {
        if (spec.pattern() !== '/#!.')
            throw new Error('incomplete event spec');

        if (spec.type() !== 'Host') {
            var typeid = spec.filter('/#');
            var obj = this.get(typeid);
            if (obj) obj.deliver(spec, val, repl);
        } else {
            this._super.deliver.apply(this, arguments);
        }
    },

    init: function (spec,val,repl) {

    },

    get: function (spec, callback) {
        if (spec&&spec.constructor===Function&&spec.prototype._type)
            spec = '/'+spec.prototype._type;
        spec = new Spec(spec);
        var typeid = spec.filter('/#');
        if (!typeid.has('/'))
            throw new Error('invalid spec');
        var o = typeid.has('#') && this.objects[typeid];
        if (!o) {
            var t = Syncable.types[spec.type()];
            if (!t) throw new Error('type unknown: '+spec);
            o = new t(typeid,undefined,this);
            if (typeof(callback)==='function') {
                o.on('.init',callback);
            }
        }
        return o;
    },

    addSource: function hostAddPeer(spec, peer) {
        if (false) { // their time is off so tell them so  //FIXME ???
            this.clockOffset;
        }
        var old = this.sources[peer._id];
        if (old) old.deliver(this.newEventSpec('off'), '', this);

        this.sources[peer._id] = peer;
        if (spec.op() === 'on')
            peer.deliver(this.newEventSpec('reon'), '', this); // TODO offset

        for (var sp in this.objects) {
            this.objects[sp].checkUplink();
        }

    },

    neutrals: {
        /**
         * Host forwards on() calls to local objects to support some
         * shortcut notations, like
         *          host.on('/Mouse',callback)
         *          host.on('/Mouse.init',callback)
         *          host.on('/Mouse#Mickey',callback)
         *          host.on('/Mouse#Mickey.init',callback)
         *          host.on('/Mouse#Mickey!baseVersion',repl)
         *          host.on('/Mouse#Mickey!base.x',trackfn)
         * The target object may not exist beforehand.
         * Note that the specifier is actually the second 3sig parameter
         * (value). The 1st (spec) reflects this /Host.on invocation only.
         */
        on: function hostOn(spec, filter, lstn) {
            if (!filter) // the subscriber needs "all the events"
                return this.addSource(spec,lstn);

            if (filter.constructor===Function && filter.id) {
                filter = new Spec(filter.id,'/');
            } else if (filter.constructor===String) {
                filter = new Spec(filter,'.');
            }
            // either suscribe to this Host or to some other object
            if (!filter.has('/') || filter.type()==='Host') {
                this._super._neutrals.on.call(this, spec, filter, lstn);
            } else {
                var objSpec = new Spec(filter);
                if (!objSpec.has('#')) throw new Error('no id to listen');
                objSpec = objSpec.set('.on').set(spec.version(), '!');
                this.deliver(objSpec, filter, lstn);
            }
        },

        reon: function hostReOn(spec, ts, host) {
            if (spec.type() !== 'Host') throw new Error('Host.reon(/NotHost.reon)');
            /// well.... TODO
            this.addSource(spec, host);
        },

        off: function (spec, nothing, peer) {
            peer.deliver(peer.spec().add(this.time(),'!').add('.reoff'), '', this);
            this.removeSource(spec, peer);
        },

        reoff: function hostReOff(spec, nothing, peer) {
            this.removeSource(spec, peer);
        }

    }, // neutrals

    removeSource: function (spec, peer) {
        if (spec.type() !== 'Host') throw new Error('Host.removeSource(/NoHost)');

        if (this.sources[peer._id] !== peer) {
            console.error('peer unknown', peer._id); //throw new Error
            return;
        }
        delete this.sources[peer._id];
        for (var sp in this.objects) {
            var obj = this.objects[sp];
            if (obj.getListenerIndex(peer, true) > -1) {
                obj.off(sp, '', peer);
                obj.checkUplink(sp);
            }
        }
    },


    /**
     * Returns an unique Lamport timestamp on every invocation.
     * Swarm employs 30bit integer Unix-like timestamps starting epoch at
     * 1 Jan 2010. Timestamps are encoded as 5-char base64 tokens; in case
     * several events are generated by the same process at the same second
     * then sequence number is added so a timestamp may be more than 5
     * chars. The id of the Host (+user~session) is appended to the ts.
     */
    time: function () {
        var d = new Date().getTime() - Host.EPOCH + (this.clockOffset || 0),
            ts = Spec.int2base((d / 1000) | 0, 5),
            res = ts;
        if (ts === this.lastTs) {
            res += Spec.int2base(++this.tsSeq, 2); // max ~4000Hz
        } else {
            this.tsSeq = 0;
        }
        res += '+' + this._id;
        this.lastTs = ts;
        this._version = '!' + res;
        return res;
    },

    /**
     * Returns an array of sources (caches,storages,uplinks,peers)
     * a given replica should be subscribed to. This default
     * implementation uses a simple consistent hashing scheme.
     * Note that a client may be connected to many servers
     * (peers), so the uplink selection logic is shared.
     * @param {Spec} spec some object specifier
     * @returns {Array} array of currently available uplinks for specified object
     */
    getSources: function (spec) {
        var self = this,
            uplinks = [],
            mindist = 4294967295,
            rePeer = /^swarm~/, // peers, not clients
            target = env.hashfn(spec),
            closestPeer = null;

        if (rePeer.test(this._id)) {
            mindist = Host.hashDistance(this._id, target);
            closestPeer = this.storage;
        } else {
            uplinks.push(self.storage); // client-side cache
        }

        for (var id in this.sources) {
            if (!rePeer.test(id)) continue;

            var dist = Host.hashDistance(id, target);
            if (dist < mindist) {
                closestPeer = this.sources[id];
                mindist = dist;
            }
        }
        if (closestPeer) uplinks.push(closestPeer);

        return uplinks;
    },

    isUplinked: function () {
        for(var id in this.sources)
            if (/^swarm~.*/.test(id))
                return true;
        return false;
    },

    register: function (obj) {
        var spec = obj.spec();
        if (spec in this.objects)
            return this.objects[spec];
        this.objects[spec] = obj;
        return obj;
    },

    unregister: function (obj) {
        var spec = obj.spec();
        // TODO unsubscribe from the uplink - swarm-scale gc
        if (spec in this.objects) delete this.objects[spec];
    },

    // waits for handshake from stream
    accept: function (stream_or_url, pipe_env) {
        new Pipe(this, stream_or_url, pipe_env);
    },

    // initiate handshake with peer
    connect: function (stream_or_url, pipe_env) {
        var pipe = new Pipe(this, stream_or_url, pipe_env);
        pipe.deliver(this.newEventSpec('.on'), '', this);
        return pipe;
    },

    disconnect: function (id) {
        for (var peer_id in this.sources) {
            if (id && peer_id!=id) continue;
            if (peer_id===this._id) continue; // storage
            var peer = this.sources[peer_id];
            // normally, .off is sent by a downlink
            peer.deliver(peer.spec().add(this.time(),'!').add('.off'));
        }
    },

    checkUplink: function (spec) {
        //  TBD Host event relay + PEX
    }
});

Host.MAX_INT = 9007199254740992;
Host.EPOCH = 1262275200000; // 1 Jan 2010 (milliseconds)
Host.MAX_SYNC_TIME = 60*60000; // 1 hour (milliseconds)
Host.HASH_POINTS = 3;

Host.hashDistance = function hashDistance(peer, obj) {
    if ((obj).constructor !== Number) {
        if (obj._id) obj = obj._id;
        obj = env.hashfn(obj);
    }
    if (peer._id) peer = peer._id;
    var dist = 4294967295;
    for (var i = 0; i < Host.HASH_POINTS; i++) {
        var hash = env.hashfn (peer._id + ':' + i);
        dist = Math.min(dist, hash ^ obj);
    }
    return dist;
};

module.exports = Host;

},{"./Pipe":6,"./Spec":10,"./Syncable":12,"./env":14}],4:[function(require,module,exports){
var Swarm = module.exports = {};

Swarm.env = require('./env');
Swarm.Spec = require('./Spec');
Swarm.Syncable = require('./Syncable');
Swarm.Model = require('./Model');
Swarm.Set = require('./Set');
Swarm.Host = require('./Host');
Swarm.Pipe = require('./Pipe');
Swarm.Storage = require('./Storage');
Swarm.SharedWebStorage = require('./SharedWebStorage');
Swarm.WebSocketStream = require('./WebSocketStream');

},{"./Host":3,"./Model":5,"./Pipe":6,"./Set":8,"./SharedWebStorage":9,"./Spec":10,"./Storage":11,"./Syncable":12,"./WebSocketStream":13,"./env":14}],5:[function(require,module,exports){
var Spec = require('./Spec');
var Syncable = require('./Syncable');

/**
 * Model (LWW key-value object)
 * @param idOrState
 * @constructor
 */
function Model (idOrState) {
    var ret = Model._super.apply(this, arguments);
    if (ret === this && idOrState && idOrState.constructor !== String && !Spec.is(idOrState)) {
        this.deliver(this.spec().add(this._id,'!').add('.set'),idOrState);
    }
}

var Model = Syncable.extend(Model,{
    defaults: {
        _oplog: Object
    },
    /**  init modes:
    *    1  fresh id, fresh object
    *    2  known id, stateless object
    *    3  known id, state boot
    */
    neutrals: {
        on: function (spec, base, repl) {
            //  support the model.on('field',callback_fn) pattern
            if (typeof(repl) === 'function' &&
                    typeof(base) === 'string' &&
                    (base in this.constructor.defaults)) {
                var stub = {
                    fn: repl,
                    key: base,
                    self: this,
                    _op: 'set',
                    deliver: function (spec, val, src) {
                        if (this.key in val) this.fn.call(this.self,spec,val,src);
                    }
                };
                repl = stub;
                base = '';
            }
            // this will delay response if we have no state yet
            Syncable._pt._neutrals.on.call(this,spec,base,repl);
        },

        off: function (spec, base, repl) {
            var ls = this._lstn;
            if (typeof(repl) === 'function') { // TODO ugly
                for (var i = 0; i < ls.length; i++) {
                    if (ls[i] && ls[i].fn === repl && ls[i].key === base) {
                        repl = ls[i];
                        break;
                    }
                }
            }
            Syncable._pt._neutrals.off.apply(this, arguments);
        }

        /*init: function (spec,snapshot,host) {
            if (this._version && this._version!=='0')
                return; // FIXME tail FIXME
            snapshot && this.apply(snapshot);
            Syncable._pt.__init.apply(this,arguments);
        }*/
    },

    // TODO remove unnecessary value duplication
    packState: function (state) {
    },
    unpackState: function (state) {
    },
    /**
     * Removes redundant information from the log; as we carry a copy
     * of the log in every replica we do everythin to obtain the minimal
     * necessary subset of it.
     * As a side effect, distillLog allows up to handle some partial
     * order issues (see _ops.set).
     * @see Model.ops.set
     * @returns {*} distilled log {spec:true}
     */
    distillLog: function () {
        // explain
        var sets = [],
            cumul = {},
            heads = {},
            spec;
        for (var s in this._oplog) {
            spec = new Spec(s);
            //if (spec.op() === 'set') {
                sets.push(spec);
            //}
        }
        sets.sort();
        for (var i = sets.length - 1; i >= 0; i--) {
            spec = sets[i];
            var val = this._oplog[spec],
                notempty = false;
            for (var field in val) {
                if (field in cumul) {
                    delete val[field];
                } else {
                    notempty = cumul[field] = val[field]; //store last value of the field
                }
            }
            var source = spec.source();
            notempty || (heads[source] && delete this._oplog[spec]);
            heads[source] = true;
        }
        return cumul;
    },

    ops: {
        /**
         * This barebones Model class implements just one kind of an op:
         * set({key:value}). To implment your own ops you need to understand
         * implications of partial order as ops may be applied in slightly
         * different orders at different replicas. This implementation
         * may resort to distillLog() to linearize ops.
         */
        set: function (spec, value, repl) {
            var version = spec.version(),
                vermet = spec.filter('!.').toString();
            if (version < this._version.substr(1)) {
                this._oplog[vermet] = value;
                this.distillLog(); // may amend the value
                value = this._oplog[vermet];
            }
            value && this.apply(value);
        }
    },

    fill: function (key) { // TODO goes to Model to support references
        if (!this.hasOwnProperty(key)) throw new Error('no such entry');

        //if (!Spec.is(this[key]))
        //    throw new Error('not a specifier');
        var spec = new Spec(this[key]).filter('/#');
        if (spec.pattern() !== '/#') throw new Error('incomplete spec');

        this[key] = this._host.get(spec);
        /* TODO new this.refType(id) || new Swarm.types[type](id);
        on('init', function(){
            self.emit('fill',key,this)
            self.emit('full',key,this)
        });*/
    },

    /**
     * Generate .set operation after some of the model fields were changed
     * TODO write test for Model.save()
     */
    save: function () {
        var cumul = this.distillLog(),
            changes = {},
            pojo = this.pojo(),
            field;
        for (field in pojo) {
            if (this[field] !== cumul[field]) {// TODO nesteds
                changes[field] = this[field];
            }
        }
        for (field in cumul) {
            if (!(field in pojo)) {
                changes[field] = null; // JSON has no undefined
            }
        }
        this.set(changes);
    },

    validate: function (spec, val) {
        if (spec.op() !== 'set') return ''; // no idea
        for (var key in val)
            if (!Model.reFieldName.test(key)) return 'bad field name';
        return '';
    }

});
module.exports = Model;
Model.reFieldName = /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/;

// Model may have reactions for field changes as well as for 'real' ops/events
// (a field change is a .set operation accepting a {field:newValue} map)
Model.addReaction = function (methodOrField, fn) {
    var proto = this.prototype;
    if (typeof (proto[methodOrField]) === 'function') { // it is a field name
        return Syncable.addReaction.call(this, methodOrField, fn);
    } else {
        var wrapper = function (spec,val) {
            if (methodOrField in val)
                fn.apply(this, arguments);
        };
        wrapper._rwrap = true;
        return Syncable.addReaction.call(this, 'set', wrapper);
    }
};

},{"./Spec":10,"./Syncable":12}],6:[function(require,module,exports){
var env = require('./env');
var Spec = require('./Spec');

/**
 * A "pipe" is a channel to a remote Swarm Host. Pipe's interface
 * mocks a Host except all calls are serialized and sent to the
 * *stream*; any arriving data is parsed and delivered to the
 * local host. The *stream* must support an interface of write(),
 * end() and on('open'|'data'|'close'|'error',fn).  Instead of a
 * *stream*, the caller may supply an *uri*, so the Pipe will
 * create a stream and connect/reconnect as necessary.
 */

function Pipe (host, stream, opts) {
    var self = this;
    self.opts = opts || {};
    if (!stream || !host)
        throw new Error('new Pipe(host,stream[,opts])');

    self._id = null;
    self.host = host;
    // uplink/downlink state flag;
    //  true: this side initiated handshake >.on <.reon
    //  false: this side received handshake <.on >.reon
    //  undefined: nothing sent/received OR had a .reoff
    this.isOnSent = undefined;
    this.reconnectDelay = self.opts.reconnectDelay || 1000;
    self.serializer = self.opts.serializer || JSON;
    self.katimer = null;
    self.send_timer = null;
    self.lastSendTS = self.lastRecvTS = self.time();
    self.bundle = {};
    // don't send immediately, delay to bundle more messages
    self.delay = self.opts.delay || -1;
    //self.reconnectDelay = self.opts.reconnectDelay || 1000;
    if (typeof(stream.write) !== 'function') { // TODO nicer
        var url = stream.toString();
        var m = url.match(/(\w+):.*/);
        if (!m) throw new Error('invalid url '+url);
        var proto = m[1].toLowerCase();
        var fn = env.streams[proto];
        if (!fn) throw new Error('protocol not supported: ' + proto);
        self.url = url;
        stream = new fn(url);
    }
    self.connect(stream);
}

module.exports = Pipe;
//env.streams = {};
Pipe.TIMEOUT = 60000; //ms

Pipe.prototype.connect = function pc (stream) {
    var self = this;
    self.stream = stream;

    self.stream.on('data', function onMsg(data) {
        data = data.toString();
        env.trace && env.log(dotIn, data, this, this.host);
        self.lastRecvTS = self.time();
        var json = self.serializer.parse(data);
        try {
            self._id ? self.parseBundle(json) : self.parseHandshake(json);
        } catch (ex) {
            console.error('error processing message', ex);
            // TODO FIXME serialize the error, send it back (but don't make it worse)
        }
        self.reconnectDelay = self.opts.reconnectDelay || 1000;
    });

    self.stream.on('close', function onConnectionClosed(reason) {
        self.stream = null; // needs no further attention
        self.close("stream closed");
    });

    self.stream.on('error', function(err) {
        self.close('stream error event: '+err);
    });

    self.katimer = setInterval(self.keepAliveFn.bind(self), (Pipe.TIMEOUT/4+Math.random()*100)|0);

    // NOPE client only finally, initiate handshake
    // self.host.connect(self);

};

Pipe.prototype.keepAliveFn = function () {
    var now = this.time(),
        sinceRecv = now - this.lastRecvTS,
        sinceSend = now - this.lastSendTS;
    if (sinceSend > Pipe.TIMEOUT/2) this.sendBundle();
    if (sinceRecv > Pipe.TIMEOUT) this.close("stream timeout");
};

Pipe.prototype.parseHandshake = function ph (handshake) {
    var spec, value, key;
    for (key in handshake) {
        spec = new Spec(key);
        value = handshake[key];
        break; // 8)-
    }
    if (!spec)
        throw new Error('handshake has no spec');
    if (spec.type()!=='Host')
        env.warn("non-Host handshake");
    if (spec.id()===this.host._id)
        throw new Error('self hs');
    this._id = spec.id();
    var op = spec.op();
    var evspec = spec.set(this.host._id, '#');

    if (op in {on: 1, reon: 1, off: 1, reoff: 1}) {// access denied TODO
        this.host.deliver(evspec, value, this);
    } else {
        throw new Error('invalid handshake');
    }
};

/**
 * Close the underlying stream.
 * Schedule new Pipe creation (when error passed).
 * note: may be invoked multiple times
 * @param {Error|string} error
 */
Pipe.prototype.close = function pc (error) {
    env.log(dotClose, error ? 'error: '+error : 'correct', this, this.host);
    if (error && this.host && this.url) {
        var uplink_uri = this.url,
            host = this.host,
            pipe_opts = this.opts;
        //reconnect delay for next disconnection
        pipe_opts.reconnectDelay = Math.min(30000, this.reconnectDelay << 1);
        // schedule a retry
        setTimeout(function () {
            host.connect(uplink_uri, pipe_opts);
        }, this.reconnectDelay);

        this.url = null; //to prevent second reconnection timer
    }
    if (this.host) {
        if (this.isOnSent!==undefined && this._id) {
            // emulate normal off
            var offspec = this.host.newEventSpec(this.isOnSent ? 'off' : 'reoff');
            this.host.deliver(offspec, '', this);
        }
        this.host = null; // can't pass any more messages
    }
    if (this.katimer) {
        clearInterval(this.katimer);
        this.katimer = null;
    }
    if (this.stream) {
        try {
            this.stream.close();
        } catch(ex) {}
        this.stream = null;
    }
    this._id = null;
};

/**
 * Sends operation to remote
 */
Pipe.prototype.deliver = function pd(spec, val, src) {
    var self = this;
    val && val.constructor === Spec && (val = val.toString());
    if (spec.type() === 'Host') {
        switch (spec.op()) {
        case 'reoff':
            setTimeout(function itsOverReally() {
                self.isOnSent=undefined;
                self.close();
            }, 1); break;
        case 'off':
            setTimeout(function tickingBomb() { self.close() }, 5000); break;
        case 'on':
            this.isOnSent = true;
        case 'reon':
            this.isOnSent = false;
        }
    }
    this.bundle[spec] = val===undefined ? null : val; // TODO aggregation
    if (this.delay === -1) {
        this.sendBundle();
    } else if (!this.send_timer) {
        var now = this.time(),
            gap = now - this.lastSendTS,
            timeout = gap > this.delay ? this.delay : this.delay - gap;
        this.send_timer = setTimeout(this.sendBundle.bind(this), timeout); // hmmm...
    } else {} // just wait
};

/** @returns {number} milliseconds as an int */
Pipe.prototype.time = function () { return new Date().getTime(); };

/**
 * @returns {Spec|string} remote host spec "/Host#peer_id" or empty string (when not handshaken yet)
 */
Pipe.prototype.spec = function () {
    return this._id ? new Spec('/Host#'+this._id) : '';
};
/**
 * @param {*} bundle is a bunch of operations in a form {operation_spec: operation_params_object}
 * @private
 */
Pipe.prototype.parseBundle = function pb(bundle) {
    var spec_list = [], spec, self=this;
    //parse specifiers
    for (spec in bundle) { spec && spec_list.push(new Spec(spec)); }
    spec_list.sort().reverse();
    var reoff_received = false;
    while (spec = spec_list.pop()) {
        spec = Spec.as(spec);
        this.host.deliver(spec, bundle[spec], this);
        if (spec.type() === 'Host' && spec.op()==='reoff') { //TODO check #id
            setTimeout(function(){
                self.isOnSent=undefined;
                self.close();
            },1);
        }
    }
};

var dotIn = new Spec('/Pipe.in');
var dotOut = new Spec('/Pipe.out');
var dotClose = new Spec('/Pipe.close');
var dotOpen = new Spec('/Pipe.open');

/**
 * Sends operations buffered in this.bundle as a bundle {operation_spec: operation_params_object}
 * @private
 */
Pipe.prototype.sendBundle = function pS() {
    var payload = this.serializer.stringify(this.bundle);
    this.bundle = {};
    if (!this.stream) {
        this.send_timer = null;
        return; // too late
    }

    try {
        env.trace && env.log(dotOut, payload, this, this.host);
        this.stream.write(payload);
        this.lastSendTS = this.time();
    } catch (ex) {
        env.error('stream error on write: ' + ex, ex.stack);
        if (this._id) this.close('stream error',ex);
    } finally {
        this.send_timer = null;
    }
};

},{"./Spec":10,"./env":14}],7:[function(require,module,exports){
var env = require('./env');
var Spec = require('./Spec');

// This stream implementation uses postMessage to synchronize to
// another IFRAME (use URIs like iframe:parent or iframe:elementId)
function PostMessageStream(frameUri, origin, secret) {
    this.origin = origin;
    this.lstn = {};
    if (frameUri.constructor === String) {
        var m = frameUri.match(/^iframe:(\w+)/i);
        if (!m) throw new Error('invalid URL');
        var frameId = m[1];
        if (!frameId || frameId === 'parent') {
            this.targetWindow = window.parent;
        } else {
            var i = document.getElementById(frameId);
            if (!i) throw new Error('element unknown: '+frameId);
            if (!i.contentWindow) throw new Error('not an IFRAME');
            this.targetWindow = i.contentWindow;
        }
    } else {
        if (!frameUri.location) throw new Error('1st param: target frame');
        this.targetWindow = frameUri;
    }
    var rnd = (Math.random()*100000000)|0;
    var time = (new Date().getTime() / 1000)|0;
    this.secret = secret ||
        ( Spec.int2base(time) + '~' + Spec.int2base(rnd) ) ;
    PostMessageStream.streams[this.secret] = this;
    this.pending = null;
    this.retries = 0;
    this.retryInt = null;
    if (!secret) { // make sure somebody listens on the other end
        this.pending = '';
        var self = this;
        this.retryInt = setInterval(function(){
            self.retryHandshake();
        },100); // keep pinging the other frame for 1 second
    }
    this.write(''); // handshake
}
PostMessageStream.streams = {};
PostMessageStream.re64 = /^([0-9A-Za-z_~]+)>/;

PostMessageStream.prototype.retryHandshake = function () {
    if (this.pending===null) { // it's OK
        clearInterval(this.retryInt);
        return;
    }
    if (this.retries++>10) {
        clearInterval(this.retryInt);
        this.lstn.error && this.lstn.error('no response from the frame');
        this.close();
    } else {
        this.write('');
        console.warn('retrying postMessage handshake');
    }
};

PostMessageStream.prototype.onMessage = function (msg,origin) {
    if (this.origin && origin!==this.origin) {
        console.warn('mismatched origin: ',origin,this.origin);
        return;
    }
    if (this.pending!==null) {
        var p = this.pending;
        this.pending = null;
        p && this.write(p);
    }
    msg && this.lstn.data && this.lstn.data(msg);
};

// FIXME: explicitly invoke (security - entry point)
window.addEventListener('message', function onPostMessage (ev) {
    var msg = ev.data.toString();
    var m = msg.match(PostMessageStream.re64);
    if (!m) return;
    var secret = m[1], json = msg.substr(secret.length+1);
    var stream = PostMessageStream.streams[secret];
    if (!stream) {
        if (!PostMessageStream.host) throw new Error('unknown stream: '+secret);
        stream = new PostMessageStream(ev.source,PostMessageStream.origin,secret);
        stream.on('close', function cleanup() {
            delete PostMessageStream.streams[secret];
        });
        PostMessageStream.host.accept(stream);
    }
    stream.onMessage(json,ev.origin);
});

PostMessageStream.listen = function (host,origin) {
    PostMessageStream.host = host;
    PostMessageStream.origin = origin;
};


PostMessageStream.prototype.on = function (evname, fn) {
    if (evname in this.lstn) {
        var self = this,
            prev_fn = this.lstn[evname];
        this.lstn[evname] = function () {
            prev_fn.apply(self, arguments);
            fn.apply(self, arguments);
        }
    } else {
        this.lstn[evname] = fn;
    }
};

PostMessageStream.prototype.write = function (data) {
    if (this.pending!==null) {
        this.pending += data || '';
        data = '';
    }
    var str = this.secret + '>' + data;
    this.targetWindow.postMessage(str, this.origin || '*');
};

PostMessageStream.prototype.close = function () {
    var ln = this.lstn || {};
    ln.close && ln.close();
    delete PostMessageStream.streams[this.secret];
};

PostMessageStream.prototype.log = function (event, message) {
    console.log('pm:' + this.frameId, event, message);
};

env.streams.iframe = PostMessageStream;
module.exports = PostMessageStream;

},{"./Spec":10,"./env":14}],8:[function(require,module,exports){
var env = require('./env');
var Spec = require('./Spec');
var Syncable = require('./Syncable');
var Model = require('./Model'); // TODO

/**
 * Backbone's Collection is essentially an array and arrays behave poorly
 * under concurrent writes (see OT). Hence, our primary collection type
 * is a {id:Model} Set. One may obtain a linearized version by sorting
 * them by keys or otherwise.
 * This basic Set implementation can only store objects of the same type.
 * @constructor
 */
var Set = Syncable.extend('Set', {

    defaults: {
        objects: Object,
        _oplog: Object,
        _proxy: ProxyListener
    },

    ops: {
        /**
         * Both Model and Set are oplog-only; they never pass the state on the wire,
         * only the oplog; new replicas are booted with distilled oplog as well.
         * So, this is the only point in code that mutates the state of a Set.
         */
        change: function (spec, value, repl) {
            value = this.distillOp(spec, value);
            var key_spec;
            for (key_spec in value) {
                if (value[key_spec]===1) {
                    this.objects[key_spec] = this._host.get(key_spec);
                    this.objects[key_spec].on(this._proxy);
                } else if (value[key_spec]===0) {
                    if (this.objects[key_spec]) {
                        this.objects[key_spec].off(this._proxy);
                        delete this.objects[key_spec];
                    }
                } else {
                    env.warn(this.spec(),'unexpected val',JSON.stringify(value));
                }
            }
        }
    },

    neutrals: {
        on : function (spec, val, lstn) {
            // proxied member event listening
            //TODO
            Syncable._pt._neutrals.on.apply(this, arguments);
        },
        off : function (spec, val, lstn) {
            //TODO
            Syncable._pt._neutrals.off.apply(this, arguments);
        }
    },

    validate: function (spec, val, src) {
        if (spec.op() !== 'change') return '';

        for (var key_spec in val) // member spec validity
            if (Spec.pattern(key_spec) !== '/#')
                return 'invalid spec: ' + key_spec;
        return '';
    },

    distillOp: function (spec, val) {
        if (spec.version() > this._version) return val; // no concurrent op

        var opkey = spec.filter('!.');
        this._oplog[opkey] = val;
        this.distillLog(); // may amend the value
        return this._oplog[opkey] || {};
    },

    distillLog: Model.prototype.distillLog,

    /**
     * Adds an object to the set.
     * @param {Syncable} obj the object  //TODO , its id or its specifier.
     */
    addObject: function (obj) {
        var specs = {};
        specs[obj.spec()] = 1;
        this.change(specs);
    },
    // FIXME reactions to emit .add, .remove

    removeObject: function (obj) {
        var spec = obj._id ? obj.spec() : new Spec(obj).filter('/#');
        if (spec.pattern()!=='/#') throw new Error('invalid spec: '+spec);
        var specs = {};
        specs[spec] = 0;
        this.change(specs);
    },

    /**
     * @param {Spec|string} key_spec key (specifier)
     * @returns {Syncable} object by key
     */
    get: function (key_spec) {
        key_spec = new Spec(key_spec).filter('/#');
        if (key_spec.pattern() !== '/#') throw new Error("invalid spec");

        return this.objects[key_spec];
    },

    /**
     * @param {function?} order
     * @returns {Array} sorted list of objects currently in set
     */
    list: function (order) {
        var ret = [];
        for (var key in this.objects)
            ret.push(this.objects[key]);
        ret.sort(order);
        return ret;
    }
});
module.exports = Set;

function ProxyListener () {
    // TODO deliver element events
}

},{"./Model":5,"./Spec":10,"./Syncable":12,"./env":14}],9:[function(require,module,exports){
var env = require('./env');
var Spec = require('./Spec');
var Syncable = require('./Syncable');
var Host = require('./Host');

/** There are two ways to use WebStorage. One is shared storage, where
  * all tabs/frames have access to the data. Another is to relay events
  * using the HTML5 'storage' event. The latter one should be implemented
  * as a Stream not Storage as it needs all the handshakes and stuff.
  */
 function SharedWebStorage(usePersistentStorage) {
    this.ls = usePersistentStorage || false;
    this.listeners = {};
    this._id = 'webstorage';
    this.authoritative = false;
    this.tails = {};
    var store = this.store = usePersistentStorage ? localStorage : sessionStorage;

    this.loadTails();

    var self = this;
    // FIXME compat FF, IE
    function onStorageChange (ev) {
        console.warn('@',self._host._id,'storage event',ev.key);
        if (!Spec.is(ev.key) || !ev.newValue) return;
        //if (self.store.getItem(ev.key)!==ev.newValue) return; // FIXME some hint (conflicts with tail cleanup)
        var spec = new Spec(ev.key);
        // states and tails are written as /Type#id.state/tail
        // while ops have full /#!. specifiers.
        if (spec.pattern()!=='/#!.') {
            if (spec.pattern()==='/#') delete self.tails[spec];
            return; // FIXME no-tails, upstream patch => need to actully apply that state
        }
        var ti = spec.filter('/#'), vo=spec.filter('!.');
        if (self.tails[ti] && (vo in self.tails[ti])) return;
        var value = JSON.parse(ev.newValue);
        // send the op back to our listeners
        var ln = self.listeners[ti];
        if (ln) for(var i=0; i<ln.length; i++)
            ln[i].deliver(spec,value,self);
        // FIXME .patch may need special handling
    }
    window.addEventListener('storage', onStorageChange, false);

};

module.exports = SharedWebStorage;

SharedWebStorage.prototype.loadTails = function () {
    // scan/sort specs for existing records
    var store = this.store,
        ti;
    for(var i=0; i<store.length; i++) {
        var key = store.key(i),
            spec = new Spec(key),
            value = store.getItem(key);
        if (spec.pattern() !== '/#!.') continue; // ops only

        ti = spec.filter('/#');
        var tail = this.tails[ti];
        if (!tail) tail = this.tails[ti] = [];
        tail.push(spec.filter('!.'));
    }
    for(ti in this.tails) this.tails[ti].sort();
};

SharedWebStorage.prototype.time = Host.prototype.time;

SharedWebStorage.prototype.deliver = function (spec,value,src) {
    switch (spec.op()) {
    // A storage is always an "uplink" so it never receives reon, reoff.
    case 'on':    return this.on(spec, value, src);
    case 'off':   return this.off(spec, value, src);
    case 'patch': return this.patch(spec, value, src);
    default:      return this.op(spec, value, src);
    }
};

SharedWebStorage.prototype.op = function wsOp (spec, value, src) {
    var ti = spec.filter('/#'),
        vm = spec.filter('!.'),
        tail = this.tails[ti] || (this.tails[ti] = []);
    // The storage piggybacks on the object's state/log handling logic
    // First, it adds an op to the log tail unless the log is too long...
    tail.push(vm);
    this.store.setItem(spec, JSON.stringify(value));
    if (tail.length > 5) {
        src.deliver(spec.set('.on'), '!0.init', this); // request a patch
    }
};

SharedWebStorage.prototype.patch = function wsPatch (spec, state, src) {
    var ti = spec.filter('/#');
    this.store.setItem(ti, JSON.stringify(state));
    var tail = this.tails[ti];
    if (tail) {
        var k;
        while (k = tail.pop()) this.store.removeItem(ti + k);
        delete this.tails[ti];
    }
};

SharedWebStorage.prototype.on = function (spec, base, replica) {
    spec = new Spec(spec);
    var ti = spec.filter('/#');
    var state = this.store.getItem(ti);
    if (state) {
        state = JSON.parse(state);
    } else {
        // an authoritative uplink then may send !0 responses
        if (this.authoritative) {
            state = {_version: '!0'};
            this.store.setItem(ti, JSON.stringify(state));
        }
    }

    var tailKeys = this.tails[ti];
    if (tailKeys) {
        state = state || {};
        var tail = state._tail || (state._tail = {});
        for(var i = 0; i < tailKeys.length; i++) {
            var vm = tailKeys[i];
            tail[vm] = JSON.parse(this.store.getItem(ti + vm));
        }
    }

    replica.deliver(spec.set('.patch'), state || {}, this);

    var vv = state ? Syncable.stateVersionVector(state) : '!0';

    replica.deliver(ti.add(spec.version(), '!').add('.reon'), vv, this);

    var ln = this.listeners[ti];
    if (!ln) ln = this.listeners[ti] = [];
    ln.push(replica);
};

SharedWebStorage.prototype.off = function (spec,value,src) {
    // FIXME
};

},{"./Host":3,"./Spec":10,"./Syncable":12,"./env":14}],10:[function(require,module,exports){
//  S P E C I F I E R
//
//  The Swarm aims to switch fully from the classic HTTP
//  request-response client-server interaction pattern to continuous
//  real-time synchronization (WebSocket), possibly involving
//  client-to-client interaction (WebRTC) and client-side storage
//  (WebStorage). That demands (a) unification of transfer and storage
//  where possible and (b) transferring, processing and storing of
//  fine-grained changes.
//
//  That's why we use compound event identifiers named *specifiers*
//  instead of just regular "plain" object ids everyone is so used to.
//  Our ids have to fully describe the context of every small change as
//  it is likely to be delivered, processed and stored separately from
//  the rest of the related state.  For every atomic operation, be it a
//  field mutation or a method invocation, a specifier contains its
//  class, object id, a method name and, most importantly, its
//  version id.
//
//  A serialized specifier is a sequence of Base64 tokens each prefixed
//  with a "quant". A quant for a class name is '/', an object id is
//  prefixed with '#', a method with '.' and a version id with '!'.  A
//  special quant '+' separates parts of each token.  For example, a
//  typical version id looks like "!7AMTc+gritzko" which corresponds to
//  a version created on Tue Oct 22 2013 08:05:59 GMT by @gritzko (see
//  Host.time()).
//
//  A full serialized specifier looks like
//        /TodoItem#7AM0f+gritzko.done!7AMTc+gritzko
//  (a todo item created by @gritzko was marked 'done' by himself)
//
//  Specifiers are stored in strings, but we use a lightweight wrapper
//  class Spec to parse them easily. A wrapper is immutable as we pass
//  specifiers around a lot.

function Spec (str,quant) {
    if (str && str.constructor===Spec) {
        str=str.value;
    } else { // later we assume value has valid format
        str = (str||'').toString();
        if (quant && str.charAt(0)>='0')
            str = quant + str;
        if (str.replace(Spec.reQTokExt,''))
            throw new Error('malformed specifier: '+str);
    }
    this.value = str;
    this.index = 0;
}
module.exports = Spec;

Spec.prototype.filter = function (quants) {
    var filterfn = //typeof(quants)==='function' ? quants :
        function (token,quant) {
            return quants.indexOf(quant)!==-1 ? token : '';
        };
    return new Spec(this.value.replace(Spec.reQTokExt,filterfn));
};
Spec.pattern = function (spec) {
    return spec.toString().replace(Spec.reQTokExt,'$1');
};
Spec.prototype.pattern = function () {
    return Spec.pattern(this.value);
};
Spec.prototype.token = function (quant) {
    var at = quant ? this.value.indexOf(quant,this.index) : this.index;
    if (at===-1) return undefined;
    Spec.reQTokExt.lastIndex = at;
    var m=Spec.reQTokExt.exec(this.value);
    this.index = Spec.reQTokExt.lastIndex;
    if (!m) return undefined;
    return { quant: m[1], body: m[2], bare: m[3], ext: m[4] };
};
Spec.prototype.get = function specGet (quant) {
    var i = this.value.indexOf(quant);
    if (i===-1) return '';
    Spec.reQTokExt.lastIndex = i;
    var m=Spec.reQTokExt.exec(this.value);
    return m&&m[2];
};
Spec.prototype.has = function specHas (quant) {
    return this.value.indexOf(quant)!==-1;
};
Spec.prototype.set = function specSet (spec,quant) {
    var ret = new Spec(spec,quant), m=[];
    Spec.reQTokExt.lastIndex = 0;
    while ( null !== (m=Spec.reQTokExt.exec(this.value)) )
        if (!ret.has(m[1])) ret=ret.add(m[0]);
    return ret.sort();
};
Spec.prototype.version = function () { return this.get('!'); };
Spec.prototype.op = function () { return this.get('.'); };
Spec.prototype.type = function () { return this.get('/'); };
Spec.prototype.id = function () { return this.get('#'); };
Spec.prototype.typeid = function () { return this.filter('/#'); };
Spec.prototype.source = function () { return this.token('!').ext; };

Spec.prototype.sort = function () {
    function Q (a, b) {
        var qa = a.charAt(0), qb = b.charAt(0), q = Spec.quants;
        return (q.indexOf(qa) - q.indexOf(qb)) || (a<b);
    }
    var split = this.value.match(Spec.reQTokExt);
    return new Spec(split?split.sort(Q).join(''):'');
};

Spec.prototype.add = function (spec,quant) {
    if (spec.constructor!==Spec)
        spec = new Spec(spec,quant);
    return new Spec(this.value+spec.value);
};
Spec.prototype.toString = function () { return this.value; };


Spec.int2base = function (i,padlen) {
    var ret = '', togo=padlen||5;
    for (; i||(togo>0); i>>=6, togo--)
        ret = Spec.base64.charAt(i&63) + ret;
    return ret;
};

Spec.base2int = function (base) {
    var ret = 0, l = base.match(Spec.re64l);
    for (var shift=0; l.length; shift+=6)
        ret += Spec.base64.indexOf(l.pop()) << shift;
    return ret;
};
Spec.parseToken = function (token_body) {
    Spec.reTokExt.lastIndex = -1;
    var m = Spec.reTokExt.exec(token_body);
    if (!m) return null;

    return { bare: m[1], ext: m[2] || 'swarm' }; // FIXME not generic
};

Spec.base64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~';
Spec.rT = '[0-9A-Za-z_~]+';
Spec.re64l = new RegExp('[0-9A-Za-z_~]','g');
Spec.quants = ['/','#','!','.'];
Spec.reTokExt = new RegExp('^(=)(?:\\+(=))?$'.replace(/=/g,Spec.rT));
Spec.reQTokExt = new RegExp('([/#\\.!\\*])((=)(?:\\+(=))?)'.replace(/=/g,Spec.rT),'g');
Spec.is = function (str) {
    if (str===null || str===undefined) return false;
    return str.constructor===Spec || ''===str.toString().replace(Spec.reQTokExt,'');
};
Spec.as = function (spec) {
    if (!spec) {
        return new Spec('');
    } else {
        return spec.constructor === Spec ? spec : new Spec(spec);
    }
};

Spec.Map = function VersionVectorAsAMap (vec) {
    this.map = {};
    if (vec) this.add(vec);
};
Spec.Map.prototype.add = function (versionVector) {
    var vec=new Spec(versionVector,'!'), tok;
    while ( undefined !== (tok=vec.token('!')) ) {
        var time = tok.bare, source = tok.ext||'swarm';
        if (time > (this.map[source]||''))
            this.map[source] = time;
    }
};
Spec.Map.prototype.covers = function (version) {
    Spec.reQTokExt.lastIndex = 0;
    var m = Spec.reTokExt.exec(version);
    var ts = m[1], src = m[2] || 'swarm';
    return ts <= (this.map[src]||'');
};
Spec.Map.prototype.maxTs = function () {
    var ts = null,
        map = this.map;
    for (var src in map) {
        if (!ts || ts < map[src]) {
            ts = map[src];
        }
    }
    return ts;
};
Spec.Map.prototype.toString = function (trim) {
    trim = trim || {top: 10, rot: '0'};
    var top = trim.top || 10,
        rot = '!' + (trim.rot || '0'),
        ret = [],
        map = this.map;
    for (var src in map) {
        ret.push('!' + map[src] + (src === 'swarm' ? '' : '+' + src));
    }
    ret.sort().reverse();
    while (ret.length > top || ret[ret.length - 1] <= rot) ret.pop();
    return ret.join('') || '!0';
};

},{}],11:[function(require,module,exports){
var Spec = require('./Spec');
var Syncable = require('./Syncable');
var Host = require('./Host'); // FIXME time

function Storage(async) {
    this.async = !!async || false;
    this.states = {};
    this.tails = {};
    // many implementations do not push changes
    // so there are no listeners
    this.lstn = null;
    this._id = 'dummy';
}
module.exports = Storage;
Storage.prototype.time = Host.prototype.time;

Storage.prototype.deliver = function (spec,value,src) {
    switch (spec.op()) {
        // A storage is always an "uplink" so it never receives reon, reoff.
        case 'on':    return this.on(spec, value, src);
        case 'off':   return this.off(spec, value, src);
        case 'patch': return this.patch(spec, value, src);
        default:      return this.anyOp(spec, value, src);
    }
};

Storage.prototype.on = function (spec,base,src) {
    var ti = spec.filter('/#');

    if (this.lstn) {
        var ls = this.lstn[ti];
        if (ls===undefined) {
            ls = src;
        } else if (ls!==src) {
            if (ls.constructor!==Array) ls = [ls];
            ls.push(src);
        }
        this.lstn[ti] = ls;
    }

    var self = this;
    var state;
    var tail;

    function sendResponse () {
        if (tail) {
            state._tail = state._tail || {};
            for (var s in tail) state._tail[s] = tail[s];
        }
        var tiv = ti.add(spec.version(), '!');
        src.deliver( tiv.add('.patch'), state, self );
        src.deliver( tiv.add('.reon'), Syncable.stateVersionVector(state), self );
    }

    this.readState(ti,function(err,s){
        state = s || {_version:'!0'};
        if (tail!==undefined) sendResponse();
    });

    this.readOps(ti,function(err,t){
        tail = t || null;
        if (state!==undefined) sendResponse();
    });
};


Storage.prototype.off = function (spec,value,src) {
    if (!this.lstn) return;
    var ti = spec.filter('/#');
    var ls = this.lstn[ti];
    if (ls===src) {
        delete this.lstn[ti];
    } else if (ls && ls.constructor===Array) {
        var cleared = ls.filter(function(v){return v!==src;});
        if (cleared.length)
            this.lstn[ti] = cleared;
        else
            delete this.lstn[ti];
    }
};

Storage.prototype.patch = function (spec,state,src) {
    var self = this;
    this.writeState(spec,state,function(err){
        if (err) {
            console.error('state write error:',err);
        } else {
            // FIXME self.trimTail(spec);
        }
    });
};


Storage.prototype.anyOp = function (spec,value,src) {
    var self = this;
    this.writeOp(spec,value,function(err){
        if (err===false) {
            // The storage piggybacks on the object's state/log handling logic
            // First, it adds an op to the log tail unless the log is too long...
            // ...otherwise it sends back a subscription effectively requesting
            // the state, on state arrival zeroes the tail.
            src.deliver(spec.set('.reon'),'.init',self);
        } else if (err!==true) {
            console.error('op write error:',err);
        }
    });
};


// In a real storage implementation, state and log often go into
// different backends, e.g. the state is saved to SQL/NoSQL db,
// while the log may live in a key-value storage.
// As long as the state has sufficient versioning info saved with
// it (like a version vector), we may purge the log lazily, once
// we are sure that the state is reliably saved. So, the log may
// overlap with the state (some ops are already applied). That
// provides some necessary resilience to workaround the lack of
// transactions across backends.
// In case third parties may write to the backend, go figure
// some way to deal with it (e.g. make a retrofit operation).
Storage.prototype.writeState = function (spec,state,cb) {
    var ti = spec.filter('/#');
    this.states[ti] = JSON.stringify(state);
    // tail is zeroed on state flush
    this.tails[ti] = {};
    // callback is mandatory
    cb();
};

Storage.prototype.writeOp = function (spec,value,cb) {
    var ti = spec.filter('/#');
    var vm = spec.filter('!.');
    var tail = this.tails[ti] || (this.tails[ti] = {});
    if (vm in tail) console.error('op replay @storage');
    tail[vm] = JSON.stringify(value);
    var count=0;
    for(var s in tail) count++;
    cb(count<3);
};

Storage.prototype.readState = function (ti, callback) {
    var state = JSON.parse (this.states[ti]||null);
    function sendResponse () {
        callback(null,state);
    }
    // may force async behavior
    this.async ? setTimeout(sendResponse,1) : sendResponse();
};

Storage.prototype.readOps = function (ti, callback) {
    var tail = JSON.parse (this.tails[ti]||null);
    callback(null,tail);
};

},{"./Host":3,"./Spec":10,"./Syncable":12}],12:[function(require,module,exports){
var Spec = require('./Spec');
var env = require('./env');

/**
 * Syncable: an oplog-synchronized object
 * @constructor
 */
function Syncable() {
    // listeners represented as objects that have deliver() method
    this._lstn = [',']; // we unshift() uplink listeners and push() downlinks
    // ...so _lstn is like [server1, server2, storage, ',', view, listener]
    // The most correct way to specify a version is the version vector,
    // but that one may consume more space than the data itself in some cases.
    // Hence, _version is not a fully specified version vector (see version()
    // instead). _version is essentially is the greatest operation timestamp
    // (Lamport-like, i.e. "time+source"), sometimes amended with additional
    // timestamps. Its main features:
    // (1) changes once the object's state changes
    // (2) does it monotonically (in the alphanum order sense)
    this._version = '';
    // make sense of arguments
    var args = Array.prototype.slice.call(arguments);
    this._host = (args.length && args[args.length-1]._type==='Host') ?
        args.pop() : env.localhost;
    if (Spec.is(args[0])) {
        this._id = new Spec(args.shift()).id() || this._host.time();
    }else if (typeof(args[0])==='string') {
        this._id = args.shift(); // TODO format
    } else {
        this._id=this._host.time();
        this._version = '!0'; // may apply state in the constructor, see Model
    }
    //var state = args.length ? args.pop() : (fresh?{}:undefined);
    // register with the host
    var doubl = this._host.register(this);
    if (doubl!==this) return doubl;
    // locally created objects get state immediately
    // (while external-id objects need to query uplinks)
    /*if (fresh && state) {
        state._version = '!'+this._id;
        var pspec = this.spec().add(state._version).add('.patch');
        this.deliver(pspec,state,this._host);
    }*/
    // find uplinks, subscribe
    this.checkUplink();
    return this;
};
module.exports = Syncable;

Syncable.types = {};
Syncable.isOpSink = function (obj) {
    if (!obj) return false;
    if (obj.constructor===Function) return true;
    if (obj.deliver && obj.deliver.constructor===Function) return true;
    return false;
};
Syncable.popSink = function (args) {
};
Syncable.reMethodName = /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/;
Syncable._default = {};
var noop = function() { /* noop */ };
function fnname (fn) {
    if (fn.name) return fn.name;
    return fn.toString().match(/^function\s*([^\s(]+)/)[1];
}


/**
 * All CRDT model classes must extend syncable directly or indirectly. Syncable
 * provides all the necessary oplog- and state-related primitives and methods.
 * Every state-mutating method should be explicitly declared to be wrapped
 * by extend() (see 'ops', 'neutrals', 'remotes' sections in class declaration).
 * @param {function|string} fn
 * @param {{ops:object, neutrals:object, remotes:object}} own
 */
Syncable.extend = function (fn, own) {
    var parent = this, fnid;
    if (fn.constructor!==Function) {
        var id = fn.toString();
        fn = function SomeSyncable(){
            this.reset(); // FIXME repeated initialization
            return parent.apply(this, arguments);
        };
        fnid = id; // if only it worked
    } else { // please call Syncable.constructor.apply(this,args) in your constructor
        fnid = fnname(fn);
    }

    // inheritance trick from backbone.js
    var SyncProto = function () {
        this.constructor = fn;
        this._neutrals = {};
        this._ops = {};
        var event,
            name;
        if (parent._pt) {
            //copy _neutrals & _ops from parent
            for (event in parent._pt._neutrals) {
                this._neutrals[event] = parent._pt._neutrals[event];
            }
            for (event in parent._pt._ops) {
                this._ops[event] = parent._pt._ops[event];
            }
        }

        // "Methods" are serialized, logged and delivered to replicas
        for (name in own.ops || {}) {
            if (!Syncable.reMethodName.test(name)) continue;
            this._ops[name] = own.ops[name];
            this[name] = wrapCall(name);
        }

        // "Neutrals" don't change the state
        for (name in own.neutrals || {}) {
            if (!Syncable.reMethodName.test(name)) continue;
            this._neutrals[name] = own.neutrals[name];
            this[name] = wrapCall(name);
        }

        // "Remotes" are serialized and sent upstream (like RPC calls)
        for (name in own.remotes || {}) {
            if (!Syncable.reMethodName.test(name)) continue;
            this[name] = wrapCall(name);
        }

        for (name in own) {
            if (!Syncable.reMethodName.test(name) ||
                    own[name].constructor !== Function) continue;
            this[name] = own[name];
        }
        this._super = parent.prototype;
        this._reactions = {};
        this._type = fnid;
    };

    SyncProto.prototype = parent.prototype;
    fn.prototype = new SyncProto();
    fn._pt = fn.prototype; // just a shortcut

    // default field values
    var defs = fn.defaults = own.defaults || {};
    for (var k in defs) {
        if (defs[k].constructor === Function) {
            defs[k] = {type: defs[k]};
        }
    }

    // signature normalization for logged/remote/local method calls;
    function wrapCall(name) {
        return function wrapper () {
            // assign a Lamport timestamp
            var spec = this.newEventSpec(name);
            var args = Array.prototype.slice.apply(arguments), lstn;
            // find the callback if any
            Syncable.isOpSink(args[args.length-1]) && (lstn = args.pop());
            // prettify the rest of the arguments
            if (!args.length) {  // FIXME isn't it confusing?
                args = ''; // used as 'empty'
            } else if (args.length===1) {
                args = args[0]; // {key:val}
            }
            // TODO log 'initiated'
            this.deliver(spec,args,lstn);
        };
    }

    // finishing touches
    fn._super = parent;
    fn.extend = this.extend;
    fn.addReaction = this.addReaction;
    fn.removeReaction = this.removeReaction;
    Syncable.types[fnid] = fn;
    return fn;
};

/**
 * A *reaction* is a hybrid of a listener and a method. It "reacts" on a
 * certain event for all objects of that type. The callback gets invoked
 * as a method, i.e. this===syncableObj. In an event-oriented architecture
 * reactions are rather handy, e.g. for creating mixins.
 * @param {string} op operation name
 * @param {function} fn callback
 * @returns {{op:string, fn:function}}
 */
Syncable.addReaction = function (op, fn) {
    var reactions = this.prototype._reactions;
    var list = reactions[op];
    list || (list = reactions[op] = []);
    list.push(fn);
    return {op: op, fn: fn};
};

/**
 *
 * @param handle
 */
Syncable.removeReaction = function (handle) {
    var op = handle.op,
        fn = handle.fn,
        list = this.prototype._reactions[op],
        i = list.indexOf(fn);
    if (i === -1) throw new Error('reaction unknown');

    list[i] = undefined; // such a peculiar pattern not to mess up out-of-callback removal
    while (list.length && !list[list.length-1]) list.pop();
};

/**
 * compare two listeners
 * @param {{deliver:function, _src:*, sink:function}} ln listener from syncable._lstn
 * @param {function|{deliver:function}} other some other listener or function
 * @returns {boolean}
 */
Syncable.listenerEquals = function (ln, other) {
    return !!ln && ((ln === other) ||
        (ln._src && ln._src === other) ||
        (ln.sink && ln.sink === other));
};

// Syncable includes all the oplog, change propagation and distributed
// garbage collection logix.
Syncable.extend(Syncable, {  // :P
    /**
     * @returns {Spec} specifier "/Type#objid"
     */
    spec: function () { return new Spec('/'+this._type+'#'+this._id); },

    /**
     * Generates new specifier with unique version
     * @param {string} op operation
     * @returns {Spec}
     */
    newEventSpec: function (op) {
        return this.spec().add(this._host.time(),'!').add(op,'.');
    },

    /**
     * Returns current object state specifier
     * @returns {string} specifier "/Type#objid!version+source[!version+source2...]"
     */
    stateSpec: function () {
        return this.spec() + (this._version||''); //?
    },

    /**
     * Applies a serialized operation (or a batch thereof) to this replica
     */
    deliver: function (spec, value, lstn) {
        spec = Spec.as(spec);
        var opver = '!' + spec.version(),
            error = null;

        function fail (msg,ex) {
            console.error(msg, spec, value, (ex&&ex.stack)||ex||new Error(msg));
            if (typeof(lstn) === 'function') {
                lstn(spec.set('.fail'), msg);
            } else if (lstn && typeof(lstn.error) === 'function') {
                lstn.error(spec, msg);
            } else { } // no callback provided
        }

        // sanity checks
        if (spec.pattern() !== '/#!.') return fail('malformed spec', spec);

        if (!this._id) return fail('undead object invoked');

        if (error = this.validate(spec, value)) return fail('invalid input, ' + error, value);

        if (!this.acl(spec, value, lstn)) return fail('access violation', spec);

        env.debug && env.log(spec, value, lstn);

        try{
            var call = spec.op();
            if (this._ops[call]) {  // FIXME name=>impl table
                if (this.isReplay(spec)) { // it happens
                    console.warn('replay',spec);
                    return;
                }
                // invoke the implementation
                this._ops[call].call(this, spec, value, lstn); // NOTE: no return value
                // once applied, may remember in the log...
                if (spec.op() !== 'patch') {
                    this._oplog && (this._oplog[spec.filter('!.')] = value);
                    // this._version is practically a label that lets you know whether
                    // the state has changed. Also, it allows to detect some cases of
                    // concurrent change, as it is always set to the maximum version id
                    // received by this object. Still, only the full version vector may
                    // precisely and uniquely specify the current version (see version()).
                    this._version = (opver > this._version) ? opver : this._version + opver;
                }
                // ...and relay further to downstream replicas and various listeners
                this.emit(spec, value, lstn);
            } else if (this._neutrals[call]) {
                // invoke the implementation
                this._neutrals[call].call(this, spec, value, lstn);
                // and relay to listeners
                this.emit(spec, value, lstn);
            } else {
                this.unimplemented(spec, value, lstn);
            }
        } catch(ex) { // log and rethrow; don't relay further; don't log
            return fail("method execution failed", ex);
        }

        // to force async signatures we eat the returned value silently
        return spec;
    },

    /**
     * Notify all the listeners of a state change (i.e. the operation applied).
     */
    emit: function (spec, value, src) {
        var ls = this._lstn,
            op = spec.op(),
            is_neutrals = !!this._neutrals[op];
        if (ls) {
            var notify = [];
            for(var i=0; i<ls.length; i++) {
                var l = ls[i];
                // skip empties, deferreds and the source
                if (!l || l===',' || l===src) continue;
                if (is_neutrals && l._op!==op) continue;
                if (l._op && l._op!==op) continue;
                notify.push(l);
            }
            for(i=0; i<notify.length; i++) { // screw it I want my 'this'
                try {
                    notify[i].deliver(spec, value, this);
                } catch (ex) {
                    console.error(ex.message, ex.stack);
                }
            }
        }
        var r = this._reactions[spec.op()];
        if (r) {
            r.constructor!==Array && (r = [r]);
            for (i = 0; i < r.length; i++) {
                r[i] && r[i].call(this, spec, value, src);
            }
        }
    },

    trigger: function (event, params) {
        var spec = this.newEventSpec(event);
        this.deliver(spec, params);
    },

    /**
     * Blindly applies a JSON changeset to this model.
     * @param {*} values
     */
    apply: function (values) {
        for (var key in values) {
            if (key.charAt(0) === '_') continue; //skip special fields
            var def = this.constructor.defaults[key];
            this[key] = def && def.type ? new def.type(values[key]) : values[key];
        }
    },

    /**
     * @returns {Spec.Map} the version vector for this object
     */
    version: function () {
        // distillLog() may drop some operations; still, those need to be counted
        // in the version vector; so, their Lamport ids must be saved in this._vector
        var map = new Spec.Map(this._version + (this._vector || ''));
        if (this._oplog) for (var op in this._oplog) map.add(op);
        return map; // TODO return the object, let the consumer trim it to taste
    },

    /**
     * Produce the entire state or probably the necessary difference
     * to synchronize a replica which is at version *base*.
     * @returns {{_version:String, _tail:Object, *}} a state object
     * that must survive JSON.parse(JSON.stringify(obj))
     *
     * The size of a Model's distilled log is capped by the number of
     * fields in an object. In practice, that is a small number, so
     * Model uses its distilled log to transfer state (no snapshots).
     */
    diff: function (base) {
        //var vid = new Spec(this._version).get('!'); // first !token
        //var spec = vid + '.patch';
        this.distillLog(); // TODO optimize?
        var patch, spec;
        if (base && base!='!0' && base!='0') { // FIXME ugly
            var map = new Spec.Map(base || '');
            for (spec in this._oplog) {
                if (!map.covers(new Spec(spec).version())) {
                    patch = patch || { _tail: {} }; // NOTE: no _version
                    patch._tail[spec] = this._oplog[spec];
                }
            }
        } else {
            patch = {_version: '!0', _tail: {}};
            for (spec in this._oplog) patch._tail[spec] = this._oplog[spec];
        }
        return patch;
    },

    distillLog: function () {
    },

    /**
     * The method must decide whether the source of the operation has
     * the rights to perform it. The method may check both the nearest
     * source and the original author of the op.
     * If this method ever mentions 'this', that is a really bad sign.
     * @returns {boolean}
     */
    acl: function (spec,val,src) {
        return true;
    },

    /**
     * Check operation format/validity (recommendation: don't check against the current state)
     * @returns {string} '' if OK, error message otherwise.
     */
    validate: function (spec, val, src) {
        // TODO add causal stability violation check  Swarm.EPOCH  (+tests)
        return '';
    },

    /**
     * whether this op was already applied in the past
     * @returns {boolean}
     */
    isReplay: function (spec) {
        if (!this._version) return false;
        if (spec.op()==='patch') return false; // these are .on !vids
        var opver = spec.version();
        if (opver > this._version.substr(1)) return false;
        if (spec.filter('!.').toString() in this._oplog) return true; // TODO log trimming, vvectors?
        return this.version().covers(opver); // heavyweight
    },

    /**
     * External objects (those you create by supplying an id) need first to query
     * the uplink for their state. Before the state arrives they are stateless.
     * @return {boolean}
     */
    hasState: function() {
        return !!this._version;
    },

    getListenerIndex: function (search_for, uplinks_only) {
        var i = this._lstn.indexOf(search_for),
            l;
        if (i > -1) return i;

        for (i = 0, l = this._lstn.length; i < l; i++) {
            var ln = this._lstn[i];
            if (uplinks_only && ln === ',') return -1;
            if (Syncable.listenerEquals(ln, search_for)) return i;
        }
        return -1;
    },

    reset: function () {
        for (var fn = this.constructor; fn !== Syncable; fn = fn._super) {
            for (var name in fn.defaults) {
                var dv = fn.defaults[name];
                this[name] = dv.constructor === Object ? new dv.type(dv.value) : dv;
            }
        }
    },

    isUplinked: function () {
        if (this._lstn[0]===',') return false; // FIXME this is a crime
        for(var i=0; i<this._lstn.length && this._lstn[i]!==','; i++)
            if (this._lstn[i] && ('_op' in this._lstn[i]))
                return false; // filtered uplink => not ready yet
        return true;
    },

    neutrals: {
        /**
         * Subscribe to the object's operations;
         * the upstream part of the two-way subscription
         *  on() with a full filter:
         *  @param {Spec} spec /Mouse#Mickey!now.on
         *  @param {Spec|string} filter !since.event
         *  @param {{deliver:function}|function} repl callback
         *  @this {Syncable}
         */
        on: function (spec, filter, repl) {   // WELL  on() is not an op, right?
            // if no listener is supplied then the object is only
            // guaranteed to exist till the next Host.gc() run
            if (!repl) return;
            var self = this;
            // stateless objects fire no events; essentially, on() is deferred
            if (!this._version && !self.isUplinked()) {
                this._lstn.push({
                    _op: 'reon', // may not happen
                    _src: repl,
                    deliver: function () {
                        if (!self._version && !self.isUplinked()) return; // wait
                        var i = self._lstn.indexOf(this);
                        self._lstn.splice(i,1);
                        self.deliver(spec,filter,repl);
                    }
                });
                return; // defer this call till uplinks are ready
            }
            // make all listeners uniform objects
            if (repl.constructor === Function) {
                repl = {
                    sink: repl,
                    that: this,
                    deliver: function () { // .deliver is invoked on an event
                        this.sink.apply(this.that, arguments);
                    }
                };
            }

            if (filter) {
                filter = new Spec(filter,'.');
                var baseVersion = filter.get('!'),
                    filter_by_op = filter.get('.');

                if (filter_by_op === 'init'){
                    var diff_if_needed = baseVersion ? this.diff(baseVersion) : '';
                    repl.deliver (spec.set('.patch'), diff_if_needed, this); //??
                    // use once()
                    return;
                }
                if (filter_by_op) {
                    repl = {
                        sink: repl,
                        _op: filter_by_op,
                        deliver: function deliverWithFilter(spec, val, src) {
                            if (spec.op() === filter_by_op) {
                                this.sink.deliver(spec, val, src);
                            }
                        }
                    };
                }

                if (baseVersion) {
                    var diff = this.diff(baseVersion);
                    diff && repl.deliver(spec.set('.patch'), diff, this); // 2downlink
                    repl.deliver (spec.set('.reon'), this.version().toString(), this);
                }
            }

            this._lstn.push(repl);
            // TODO repeated subscriptions: send a diff, otherwise ignore
        },

        /**
         * downstream reciprocal subscription
         */
        reon: function (spec, base, repl) {
            var diff = base && this.diff(base);
            if (diff) repl.deliver(spec.set('.patch'), diff, this); // 2uplink
        },

        /** Unsubscribe */
        off: function (spec, val, repl) {
            var idx = this.getListenerIndex(repl); //TODO ??? uplinks_only?
            if (idx > -1) this._lstn.splice(idx, 1);
        },

        /** Reciprocal unsubscription */
        reoff: function (spec, val, repl) {
            var idx = this.getListenerIndex(repl); //TODO ??? uplinks_only?
            if (idx > -1) this._lstn.splice(idx, 1);
            if (this._id) this.checkUplink();
        },

        /**
         * As all the event/operation processing is asynchronous, we
         * cannot simply throw/catch exceptions over the network.
         * This method allows to send errors back asynchronously.
         * Sort of an asynchronous complaint mailbox :)
         */
        error: function (spec, val, repl) {
            console.error('something failed:',spec,val,'@',(repl&&repl._id));
        },

    }, // neutrals

    ops: {
        /**
         * A state of a Syncable CRDT object is transferred to a replica using
         * some combination of POJO state and oplog. For example, a simple LWW
         * object (Last Writer Wins, see Model below) uses its distilled oplog
         * as the most concise form. A CT document (Causal Trees) has a highly
         * compressed state, its log being hundred times heavier. Hence, it
         * mainly uses its plain state, but sometimes its log tail as well. The
         * format of the state object is POJO plus (optionally) special fields:
         * _oplog, _tail, _vector, _version (the latter flags POJO presence).
         * In either case, .state is only produced by diff() (+ by storage).
         * Any real-time changes are transferred as individual events.
         * @this {Syncable}
         */
        patch: function (spec, state, src) {

            var tail = {}, // ops to be applied on top of the received state
                typeid = spec.filter('/#'),
                lstn = this._lstn,
                a_spec;
            this._lstn = []; // prevent events from being fired

            /*if (state._version === '!0') { // uplink knows nothing FIXME dubious
                if (!this._version) this._version = '!0';
            }*/

            if (state._version/* && state._version !== '!0'*/) {
                // local changes may need to be merged into the received state
                if (this._oplog) {
                    for (a_spec in this._oplog) tail[a_spec] = this._oplog[a_spec];
                    this._oplog = {};
                }
                this._vector && (this._vector=undefined);
                // zero everything
                for (var key in this)
                    if (this.hasOwnProperty(key) && key.charAt(0)!=='_')
                        this[key]=undefined;
                // set default values
                this.reset();

                this.apply(state);
                this._version = state._version;

                state._oplog && (this._oplog = state._oplog); // FIXME copy
                state._vector && (this._vector = state._vector);
            }
            // add the received tail to the local one
            if (state._tail) {
                for (a_spec in state._tail) tail[a_spec] = state._tail[a_spec];
            }
            // appply the combined tail to the new state
            var specs = [];
            for (a_spec in tail) specs.push(a_spec);
            specs.sort().reverse();
            // there will be some replays, but those will be ignored
            while (a_spec = specs.pop()) this.deliver(typeid.add(a_spec), tail[a_spec], src);

            this._lstn = lstn;

        }

    }, // ops


    /**
     * Uplink connections may be closed or reestablished so we need
     * to adjust every object's subscriptions time to time.
     * @this {Syncable}
     */
    checkUplink: function () {
        var new_uplinks = this._host.getSources(this.spec()).slice(),
            up, self=this;
        // the plan is to eliminate extra subscriptions and to
        // establish missing ones; that only affects outbound subs
        for (var i = 0; i < this._lstn.length && this._lstn[i] != ','; i++) {
            up = this._lstn[i];
            if (!up) continue;
            up._src && (up = up._src); // unready
            var up_idx = new_uplinks.indexOf(up);
            if (up_idx === -1) { // don't need this uplink anymore
                up.deliver(this.newEventSpec('off'), '', this);
            } else {
                new_uplinks[up_idx] = undefined;
            }
        }
        // subscribe to the new
        for (i = 0; i < new_uplinks.length; i++) {
            up = new_uplinks[i];
            if (!up) continue;
            var onspec = this.newEventSpec('on');
            this._lstn.unshift({
                _op: 'reon',
                _src: up,
                deliver: function (spec,base,src) {
                    if (spec.version() !== onspec.version()) return; // not mine

                    var i = self.getListenerIndex(this);
                    self._lstn[i] = up;
                }
            });
            up.deliver(onspec, this.version().toString(), this);
        }
    },

    /**
     * returns a Plain Javascript Object with the state
     * @this {Syncable}
     */
    pojo: function (addVersionInfo) {
        var pojo = {},
            defs = this.constructor.defaults;
        for (var key in this) if (this.hasOwnProperty(key)) {
            if (Model.reFieldName.test(key) && this[key] !== undefined) {
                var def = defs[key],
                    val = this[key];
                pojo[key] = def && def.type ?
                        (val.toJSON && val.toJSON()) || val.toString() :
                        (val && val._id ? val._id : val) ; // TODO prettify
            }
        }
        if (addVersionInfo) {
            pojo._id = this._id; // not necassary
            pojo._version = this._version;
            this._vector && (pojo._vector = this._vector);
            this._oplog && (pojo._oplog = this._oplog); //TODO copy
        }
        return pojo;
    },

    /**
     * Sometimes we get an operation we don't support; not normally
     * happens for a regular replica, but still needs to be caught
     */
    unimplemented: function (spec, val, repl) {
        console.warn("method not implemented:", spec);
    },

    /**
     * Deallocate everything, free all resources.
     */
    close: function () {
        var l = this._lstn,
            s = this.spec(),
            uplink;

        this._id = null; // no id - no object; prevent relinking
        while ((uplink = l.shift()) && uplink !== ',') {
            uplink.off(s, null, this);
        }
        while (l.length) {
            l.pop().deliver(s.set('.reoff'), null, this);
        }
        this._host.unregister(this);
    },

    /**
     * Once an object is not listened by anyone it is perfectly safe
     * to garbage collect it.
     */
    gc: function () {
        var l = this._lstn;
        if (!l.length || (l.length === 1 && !l[0])) this.close();
    },

    once: function (filter, fn) { // only takes functions; syncables don't need 'once'
        this.on(filter, function onceWrap() {
            fn.apply(this, arguments); // "this" is the object
            this.off(filter, onceWrap);
        });
    }
});


/**
 * Derive version vector from a state of a Syncable object.
 * This is not a method as it needs to be applied to a flat JSON object.
 * @see Syncable.version
 * @see Spec.Map
 * @returns {string} string representation of Spec.Map
 */
Syncable.stateVersionVector = function stateVersionVector (state) {
    var op,
        map = new Spec.Map(state._version + (state._vector || ''));
    if (state._oplog) for (op in state._oplog) map.add(op);
    if (state._tail) for (op in state._tail) map.add(op);
    return map.toString();
};

},{"./Spec":10,"./env":14}],13:[function(require,module,exports){
var env = require('./env');

function WebSocketStream (url) {
    var self = this;
    var ln = this.lstn = {};
    this.url = url;
    var ws = this.ws = new WebSocket(url);
    var buf = this.buf = [];
    ws.onopen = function () {
        buf.reverse();
        self.buf = null;
        while (buf.length)
            self.write(buf.pop());

    };
    ws.onclose = function () { ln.close && ln.close() };
    ws.onmessage = function (msg) {
        ln.data && ln.data(msg.data)
    };
    ws.onerror = function (err) { ln.error && ln.error(err) };
}

WebSocketStream.prototype.on = function (evname, fn) {
    if (evname in this.lstn) {
        var self = this,
            prev_fn = this.lstn[evname];
        this.lstn[evname] = function () {
            prev_fn.apply(self, arguments);
            fn.apply(self, arguments);
        }
    } else {
        this.lstn[evname] = fn;
    }
};

WebSocketStream.prototype.write = function (data) {
    if (this.buf)
        this.buf.push(data);
    else
        this.ws.send(data);
};

env.streams.ws = env.streams.wss = WebSocketStream;
module.exports = WebSocketStream;

},{"./env":14}],14:[function(require,module,exports){
/** a really simplistic default hash function */
function djb2Hash(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++)
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    return hash;
}

var env = module.exports = {
    // maps URI schemes to stream implementations
    streams: {},
    // the default host
    localhost: undefined,
    // whether multiple hosts are allowed in one process
    // (that is mostly useful for testing)
    multihost: false,
    // hash function used for consistent hashing
    hashfn: djb2Hash,

    log: plain_log,
    debug: false,
    trace: false,

    isServer: typeof(navigator)==='undefined',
    isBrowser: typeof(navigator)==='object',
    isWebKit: false,
    isGecko: false,
    isIE: false
};

if (typeof(navigator)==='object') {
    var agent = navigator.userAgent;
    env.isWebKit = /AppleWebKit\/(\S+)/.test(agent);
    env.isIE = /MSIE ([^;]+)/.test(agent);
    env.isGecko = /rv:.* Gecko\/\d{8}/.test(agent);
}

function plain_log (spec,val,object,host) {
    var method  ='log';
    switch (spec.op()) {
        case 'error': method = 'error'; break;
        case 'warn':  method = 'warn'; break;
    }
    console[method] (spec.toString(), val, object&&object._id, host&&host._id);
}

function css_log (spec, value, replica, host) {
//    var myspec = this.spec().toString(); //:(
    if (!host && replica && replica._host) host = replica._host;
    if (value.constructor.name==='Spec') value = value.toString();
    console.log(
            "%c%s  %c%s  %c%O  %c%s @%c%s",
            "color: #888",
                env.multihost ? host&&host._id : '',
            "color: #024; font-style: italic",
                spec.toString(),
            "font-style: normal; color: #042",
                value,
            "color: #88a",
                (replica&&((replica.spec&&replica.spec().toString())||replica._id)) ||
                (replica?'no id':'undef'),
            "color: #ccd",
                replica&&replica._host&&replica._host._id
            //replica&&replica.spec&&(replica.spec()+
            //    (this._host===replica._host?'':' @'+replica._host._id)
    );
};

if (env.isWebKit || env.isGecko) env.log = css_log;

},{}]},{},[2]);
