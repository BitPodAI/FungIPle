import { elizaLogger } from "@ai16z/eliza";
import {
    Action,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    Plugin,
    State,
} from "@ai16z/eliza";

import { socialProvider, TW_KOL_1, TW_KOL_2, TW_KOL_3 } from "./social.ts";
import { TokenDataProvider } from "./tokendata.ts";


const dataEnrich: Action = {
    name: "DATA_ENRICH",
    similes: [
        "ENRICH_DATA",
        "INTERNET_DATA",
        "DATA_LOOKUP",
        "QUERY_API",
        "QUERY_DATA",
        "FIND_REALTIME_DATA",
        "DATABASE_SEARCH",
        "FIND_MORE_INFORMATION",
    ],
    description:
        "Perform a web search to find information related to the message.",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        const tavilyApiKeyOk = !!runtime.getSetting("TAVILY_API_KEY");

        return tavilyApiKeyOk;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback: HandlerCallback
    ) => {
        elizaLogger.log("Composing state for message:", message);
        state = (await runtime.composeState(message)) as State;
        const userId = runtime.agentId;
        elizaLogger.log("User ID:", userId);

        const webSearchPrompt = message.content.text;
        elizaLogger.log("web search prompt received:", webSearchPrompt);

    },
    examples: [
    ],
} as Action;

export const dataEnrichPlugin: Plugin = {
    name: "dataEnrich",
    description: "Query detail info by API/DB",
    actions: [dataEnrich],
    evaluators: [],
    providers: [socialProvider],
};

export { socialProvider, TokenDataProvider, TW_KOL_1, TW_KOL_2, TW_KOL_3 };
