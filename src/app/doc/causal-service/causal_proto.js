/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
"use strict";

var $protobuf = require("protobufjs/minimal");

// Common aliases
var $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
var $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

$root.causal = (function() {

    /**
     * Namespace causal.
     * @exports causal
     * @namespace
     */
    var causal = {};

    /**
     * CausalType enum.
     * @name causal.CausalType
     * @enum {number}
     * @property {number} ATTEST=0 ATTEST value
     * @property {number} REVEAL=1 REVEAL value
     * @property {number} WITNESS=2 WITNESS value
     * @property {number} SHARD=3 SHARD value
     * @property {number} CONFIRM=4 CONFIRM value
     * @property {number} DELIVER=5 DELIVER value
     */
    causal.CausalType = (function() {
        var valuesById = {}, values = Object.create(valuesById);
        values[valuesById[0] = "ATTEST"] = 0;
        values[valuesById[1] = "REVEAL"] = 1;
        values[valuesById[2] = "WITNESS"] = 2;
        values[valuesById[3] = "SHARD"] = 3;
        values[valuesById[4] = "CONFIRM"] = 4;
        values[valuesById[5] = "DELIVER"] = 5;
        return values;
    })();

    causal.MsgId = (function() {

        /**
         * Properties of a MsgId.
         * @memberof causal
         * @interface IMsgId
         * @property {number|null} [sd] MsgId sd
         * @property {number|null} [sn] MsgId sn
         */

        /**
         * Constructs a new MsgId.
         * @memberof causal
         * @classdesc Represents a MsgId.
         * @implements IMsgId
         * @constructor
         * @param {causal.IMsgId=} [properties] Properties to set
         */
        function MsgId(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * MsgId sd.
         * @member {number} sd
         * @memberof causal.MsgId
         * @instance
         */
        MsgId.prototype.sd = 0;

        /**
         * MsgId sn.
         * @member {number} sn
         * @memberof causal.MsgId
         * @instance
         */
        MsgId.prototype.sn = 0;

        /**
         * Creates a new MsgId instance using the specified properties.
         * @function create
         * @memberof causal.MsgId
         * @static
         * @param {causal.IMsgId=} [properties] Properties to set
         * @returns {causal.MsgId} MsgId instance
         */
        MsgId.create = function create(properties) {
            return new MsgId(properties);
        };

        /**
         * Encodes the specified MsgId message. Does not implicitly {@link causal.MsgId.verify|verify} messages.
         * @function encode
         * @memberof causal.MsgId
         * @static
         * @param {causal.IMsgId} message MsgId message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MsgId.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.sd != null && Object.hasOwnProperty.call(message, "sd"))
                writer.uint32(/* id 1, wireType 0 =*/8).int32(message.sd);
            if (message.sn != null && Object.hasOwnProperty.call(message, "sn"))
                writer.uint32(/* id 2, wireType 0 =*/16).int32(message.sn);
            return writer;
        };

        /**
         * Decodes a MsgId message from the specified reader or buffer.
         * @function decode
         * @memberof causal.MsgId
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {causal.MsgId} MsgId
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MsgId.decode = function decode(reader, length) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.causal.MsgId();
            while (reader.pos < end) {
                var tag = reader.uint32();
                switch (tag >>> 3) {
                case 1:
                    message.sd = reader.int32();
                    break;
                case 2:
                    message.sn = reader.int32();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        return MsgId;
    })();

    causal.CausalMsg = (function() {

        /**
         * Properties of a CausalMsg.
         * @memberof causal
         * @interface ICausalMsg
         * @property {causal.IMsgId|null} [mid] CausalMsg mid
         * @property {number|null} [initialSender] CausalMsg initialSender
         * @property {Object.<string,number>|null} [deliveredSd] CausalMsg deliveredSd
         * @property {causal.CausalType|null} [type] CausalMsg type
         * @property {Uint8Array|null} [shard] CausalMsg shard
         * @property {Object.<string,number>|null} [confirmed] CausalMsg confirmed
         * @property {string|null} [content] CausalMsg content
         */

        /**
         * Constructs a new CausalMsg.
         * @memberof causal
         * @classdesc Represents a CausalMsg.
         * @implements ICausalMsg
         * @constructor
         * @param {causal.ICausalMsg=} [properties] Properties to set
         */
        function CausalMsg(properties) {
            this.deliveredSd = {};
            this.confirmed = {};
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * CausalMsg mid.
         * @member {causal.IMsgId|null|undefined} mid
         * @memberof causal.CausalMsg
         * @instance
         */
        CausalMsg.prototype.mid = null;

        /**
         * CausalMsg initialSender.
         * @member {number} initialSender
         * @memberof causal.CausalMsg
         * @instance
         */
        CausalMsg.prototype.initialSender = 0;

        /**
         * CausalMsg deliveredSd.
         * @member {Object.<string,number>} deliveredSd
         * @memberof causal.CausalMsg
         * @instance
         */
        CausalMsg.prototype.deliveredSd = $util.emptyObject;

        /**
         * CausalMsg type.
         * @member {causal.CausalType} type
         * @memberof causal.CausalMsg
         * @instance
         */
        CausalMsg.prototype.type = 0;

        /**
         * CausalMsg shard.
         * @member {Uint8Array} shard
         * @memberof causal.CausalMsg
         * @instance
         */
        CausalMsg.prototype.shard = $util.newBuffer([]);

        /**
         * CausalMsg confirmed.
         * @member {Object.<string,number>} confirmed
         * @memberof causal.CausalMsg
         * @instance
         */
        CausalMsg.prototype.confirmed = $util.emptyObject;

        /**
         * CausalMsg content.
         * @member {string} content
         * @memberof causal.CausalMsg
         * @instance
         */
        CausalMsg.prototype.content = "";

        /**
         * Creates a new CausalMsg instance using the specified properties.
         * @function create
         * @memberof causal.CausalMsg
         * @static
         * @param {causal.ICausalMsg=} [properties] Properties to set
         * @returns {causal.CausalMsg} CausalMsg instance
         */
        CausalMsg.create = function create(properties) {
            return new CausalMsg(properties);
        };

        /**
         * Encodes the specified CausalMsg message. Does not implicitly {@link causal.CausalMsg.verify|verify} messages.
         * @function encode
         * @memberof causal.CausalMsg
         * @static
         * @param {causal.ICausalMsg} message CausalMsg message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CausalMsg.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.mid != null && Object.hasOwnProperty.call(message, "mid"))
                $root.causal.MsgId.encode(message.mid, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
            if (message.initialSender != null && Object.hasOwnProperty.call(message, "initialSender"))
                writer.uint32(/* id 2, wireType 0 =*/16).int32(message.initialSender);
            if (message.deliveredSd != null && Object.hasOwnProperty.call(message, "deliveredSd"))
                for (var keys = Object.keys(message.deliveredSd), i = 0; i < keys.length; ++i)
                    writer.uint32(/* id 3, wireType 2 =*/26).fork().uint32(/* id 1, wireType 0 =*/8).int32(keys[i]).uint32(/* id 2, wireType 0 =*/16).int32(message.deliveredSd[keys[i]]).ldelim();
            if (message.type != null && Object.hasOwnProperty.call(message, "type"))
                writer.uint32(/* id 4, wireType 0 =*/32).int32(message.type);
            if (message.shard != null && Object.hasOwnProperty.call(message, "shard"))
                writer.uint32(/* id 5, wireType 2 =*/42).bytes(message.shard);
            if (message.confirmed != null && Object.hasOwnProperty.call(message, "confirmed"))
                for (var keys = Object.keys(message.confirmed), i = 0; i < keys.length; ++i)
                    writer.uint32(/* id 6, wireType 2 =*/50).fork().uint32(/* id 1, wireType 0 =*/8).int32(keys[i]).uint32(/* id 2, wireType 0 =*/16).int32(message.confirmed[keys[i]]).ldelim();
            if (message.content != null && Object.hasOwnProperty.call(message, "content"))
                writer.uint32(/* id 7, wireType 2 =*/58).string(message.content);
            return writer;
        };

        /**
         * Decodes a CausalMsg message from the specified reader or buffer.
         * @function decode
         * @memberof causal.CausalMsg
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {causal.CausalMsg} CausalMsg
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CausalMsg.decode = function decode(reader, length) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.causal.CausalMsg(), key, value;
            while (reader.pos < end) {
                var tag = reader.uint32();
                switch (tag >>> 3) {
                case 1:
                    message.mid = $root.causal.MsgId.decode(reader, reader.uint32());
                    break;
                case 2:
                    message.initialSender = reader.int32();
                    break;
                case 3:
                    if (message.deliveredSd === $util.emptyObject)
                        message.deliveredSd = {};
                    var end2 = reader.uint32() + reader.pos;
                    key = 0;
                    value = 0;
                    while (reader.pos < end2) {
                        var tag2 = reader.uint32();
                        switch (tag2 >>> 3) {
                        case 1:
                            key = reader.int32();
                            break;
                        case 2:
                            value = reader.int32();
                            break;
                        default:
                            reader.skipType(tag2 & 7);
                            break;
                        }
                    }
                    message.deliveredSd[key] = value;
                    break;
                case 4:
                    message.type = reader.int32();
                    break;
                case 5:
                    message.shard = reader.bytes();
                    break;
                case 6:
                    if (message.confirmed === $util.emptyObject)
                        message.confirmed = {};
                    var end2 = reader.uint32() + reader.pos;
                    key = 0;
                    value = 0;
                    while (reader.pos < end2) {
                        var tag2 = reader.uint32();
                        switch (tag2 >>> 3) {
                        case 1:
                            key = reader.int32();
                            break;
                        case 2:
                            value = reader.int32();
                            break;
                        default:
                            reader.skipType(tag2 & 7);
                            break;
                        }
                    }
                    message.confirmed[key] = value;
                    break;
                case 7:
                    message.content = reader.string();
                    break;
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        return CausalMsg;
    })();

    return causal;
})();

module.exports = $root;
