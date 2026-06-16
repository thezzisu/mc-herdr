export declare const HerdrAgentState: () => Promise<{
    "chat.message"?: undefined;
    event?: undefined;
} | {
    "chat.message": ({ sessionID }: {
        sessionID: string;
    }) => Promise<void>;
    event: ({ event }: {
        event: {
            type: string;
            properties?: any;
        };
    }) => Promise<void>;
}>;
