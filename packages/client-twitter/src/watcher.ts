import { TOP_TOKENS, TW_KOL_1, TW_KOL_2, TW_KOL_3 } from "@ai16z/plugin-data-enrich";
import { ConsensusProvider, InferMessageProvider } from "@ai16z/plugin-data-enrich";
import {
    ModelClass,
    IAgentRuntime,
} from "@ai16z/eliza";
import { generateText } from "@ai16z/eliza";
import { ClientBase } from "./base";
import * as path from "path";


export const watcherCompletionFooter = `\nResponse format should be formatted in a JSON block like this:
[
  { "token": "{{token}}", "category": {{category}}, "count": {{count}}, "event": {{event}} }
]
, and no other text should be provided.`;

export const watcherHandlerTemplate =
    // {{goals}}
    `# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/analysis various forms of text, including HTML, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

{{actions}}

# Instructions: 
Please find the token/project involved according to the text provided, and obtain the data of the number of interactions between each token and the three category of accounts (mentions/likes/comments/reposts/posts) in the tweets related to these tokens; mark the tokens as category 1, category 2 or category 3; if there are both category 1 and category 2, choose category 1, which has a higher priority.
 And provide the brief introduction of the key event for each token. And also skip the top/famous tokens.
Please reply in Chinese and in the following format:
- Token Symbol by json name 'token';
- Token Interaction Category by json name 'category';
- Token Interaction Count by json name 'count';
- Token Key Event Introduction by json name 'event';
Use the list format and only provide these 4 pieces of information.
` + watcherCompletionFooter;

const GEN_TOKEN_REPORT_DELAY = 1000 * 60 * 60;
const TWEET_TIMELINE = 60 * 60 * 6;
const CACHE_KEY_TWITTER_WATCHER = "twitter_watcher_data";
const CACHE_KEY_DATA_ITEM = "001";

export class TwitterWatchClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    consensus: ConsensusProvider;
    inferMsgProvider: InferMessageProvider;

    private cacheKey: string = CACHE_KEY_TWITTER_WATCHER;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.consensus = new ConsensusProvider(this.runtime);
        this.inferMsgProvider = new InferMessageProvider(this.runtime.cacheManager);
    }

    private async readFromCache<T>(key: string): Promise<T | null> {
        const cached = await this.runtime.cacheManager.get<T>(
            path.join(this.cacheKey, key)
        );
        return cached;
    }

    private async writeToCache<T>(key: string, data: T): Promise<void> {
        await this.runtime.cacheManager.set(path.join(this.cacheKey, key), data, {
            expires: Date.now() + 5 * 60 * 60 * 1000,
        });
    }

    private async getCachedData<T>(key: string): Promise<T | null> {
        // Check file-based cache
        const fileCachedData = await this.readFromCache<T>(key);
        if (fileCachedData) {
            return fileCachedData;
        }

        return null;
    }

    private async setCachedData<T>(cacheKey: string, data: T): Promise<void> {
        // Write to file-based cache
        await this.writeToCache(cacheKey, data);
    }

    async start() {
        console.log("TwitterWatcher start");
        if (!this.client.profile) {
            await this.client.init();
        }
        this.consensus.startNode();

        const genReportLoop = async () => {
            console.log("TwitterWatcher loop");
            const lastGen = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>(
                "twitter/" +
                    this.runtime.getSetting("TWITTER_USERNAME") +
                    "/lastGen"
            );
            console.log(lastGen);

            const lastGenTimestamp = lastGen?.timestamp ?? 0;
            if (Date.now() > lastGenTimestamp + GEN_TOKEN_REPORT_DELAY) {
                await this.fetchTokens();
            }

            setTimeout(() => {
                genReportLoop(); // Set up next iteration
            }, GEN_TOKEN_REPORT_DELAY);

            console.log(`Next tweet scheduled in ${GEN_TOKEN_REPORT_DELAY / 60 / 1000} minutes`);
        };
        genReportLoop();
    }

    async fetchTokens() {
        console.log("TwitterWatcher fetchTokens");
        let fetchedTokens = new Map();

        try {
            const currentTime = new Date();
            const timeline = Math.floor(currentTime.getTime() / 1000) - TWEET_TIMELINE;
            for (const kolList of [TW_KOL_1, TW_KOL_2, TW_KOL_3]) {
                //let twText = "";
                let kolTweets = [];
                for (const kol of kolList) {
                    //console.log(kol.substring(1));
                    let tweets = await this.client.twitterClient.getTweetsAndReplies(kol.substring(1), 60);
                    // Fetch and process tweets
                    for await (const tweet of tweets) {
                        if (tweet.timestamp < timeline) {
                            continue; // Skip the outdates.
                        }
                        kolTweets.push(tweet);
                        //twText = twText.concat("START_OF_TWEET_TEXT: [" + tweet.text + "] END_OF_TWEET_TEXT");
                    }
                }
                console.log(kolTweets.length);

                const prompt = `
                Here are some tweets/replied:
                    ${[...kolTweets]
                        .filter((tweet) => {
                            // ignore tweets where any of the thread tweets contain a tweet by the bot
                            const thread = tweet.thread;
                            const botTweet = thread.find(
                                (t) => t.username === this.runtime.getSetting("TWITTER_USERNAME")
                            );
                            return !botTweet;
                        })
                        .map(
                            (tweet) => `
                    From: ${tweet.name} (@${tweet.username})
                    Text: ${tweet.text}`
                ).join("\n")}
            
Please find the token/project involved according to the text provided, and obtain the data of the number of interactions between each token and the three category of accounts (mentions/likes/comments/reposts/posts) in the tweets related to these tokens; mark the tokens as category 1, category 2 or category 3; if there are both category 1 and category 2, choose category 1, which has a higher priority.
 And provide the brief introduction of the key event for each token. And also skip the top/famous tokens.
Please reply in English and in the following format:
- Token Symbol by json name 'token';
- Token Interaction Category by json name 'category';
- Token Interaction Count by json name 'count';
- Token Key Event Introduction by json name 'event';
Use the list format and only provide these 3 pieces of information.`
 + watcherCompletionFooter;

                let response = await generateText({
                    runtime: this.runtime,
                    context: prompt,
                    modelClass: ModelClass.MEDIUM,
                });
                console.log(response);
                await this.inferMsgProvider.addInferMessage(response);
            }

            // Consensus for All Nodes
            let report = await InferMessageProvider.getLatestReport(this.runtime.cacheManager);
            await this.consensus.pubMessage(report);

            // Post Tweet of myself
            let tweet = await this.inferMsgProvider.getAlphaText();
            console.log(tweet);
            const result = await this.client.requestQueue.add(
                async () =>
                    await this.client.twitterClient.sendTweet(tweet)
            );
        } catch (error) {
            console.error("An error occurred:", error);
        }
        return fetchedTokens;
    }
}
