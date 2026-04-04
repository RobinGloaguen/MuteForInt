import * as $protobuf from "protobufjs";
/** Namespace causal. */
export namespace causal {

    /** CausalType enum. */
    enum CausalType {
        ATTEST = 0,
        REVEAL = 1,
        WITNESS = 2,
        SHARD = 3,
        CONFIRM = 4,
        DELIVER = 5
    }

    /** Properties of a MsgId. */
    interface IMsgId {

        /** MsgId sd */
        sd?: (number|null);

        /** MsgId sn */
        sn?: (number|null);
    }

    /** Represents a MsgId. */
    class MsgId implements IMsgId {

        /**
         * Constructs a new MsgId.
         * @param [properties] Properties to set
         */
        constructor(properties?: causal.IMsgId);

        /** MsgId sd. */
        public sd: number;

        /** MsgId sn. */
        public sn: number;

        /**
         * Creates a new MsgId instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MsgId instance
         */
        public static create(properties?: causal.IMsgId): causal.MsgId;

        /**
         * Encodes the specified MsgId message. Does not implicitly {@link causal.MsgId.verify|verify} messages.
         * @param message MsgId message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: causal.IMsgId, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MsgId message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MsgId
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): causal.MsgId;
    }

    /** Properties of a CausalMsg. */
    interface ICausalMsg {

        /** CausalMsg mid */
        mid?: (causal.IMsgId|null);

        /** CausalMsg initialSender */
        initialSender?: (number|null);

        /** CausalMsg deliveredSd */
        deliveredSd?: ({ [k: string]: number }|null);

        /** CausalMsg type */
        type?: (causal.CausalType|null);

        /** CausalMsg shard */
        shard?: (Uint8Array|null);

        /** CausalMsg confirmed */
        confirmed?: ({ [k: string]: number }|null);

        /** CausalMsg content */
        content?: (string|null);
    }

    /** Represents a CausalMsg. */
    class CausalMsg implements ICausalMsg {

        /**
         * Constructs a new CausalMsg.
         * @param [properties] Properties to set
         */
        constructor(properties?: causal.ICausalMsg);

        /** CausalMsg mid. */
        public mid?: (causal.IMsgId|null);

        /** CausalMsg initialSender. */
        public initialSender: number;

        /** CausalMsg deliveredSd. */
        public deliveredSd: { [k: string]: number };

        /** CausalMsg type. */
        public type: causal.CausalType;

        /** CausalMsg shard. */
        public shard: Uint8Array;

        /** CausalMsg confirmed. */
        public confirmed: { [k: string]: number };

        /** CausalMsg content. */
        public content: string;

        /**
         * Creates a new CausalMsg instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CausalMsg instance
         */
        public static create(properties?: causal.ICausalMsg): causal.CausalMsg;

        /**
         * Encodes the specified CausalMsg message. Does not implicitly {@link causal.CausalMsg.verify|verify} messages.
         * @param message CausalMsg message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: causal.ICausalMsg, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CausalMsg message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CausalMsg
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): causal.CausalMsg;
    }
}
