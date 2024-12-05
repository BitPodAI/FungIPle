import { Scraper } from "agent-twitter-client";
import { AgentRuntime, UUID } from "@ai16z/eliza";
import { TW_KOL_1, TW_KOL_2, TW_KOL_3 } from "@ai16z/plugin-data-enrich";
import {
    Content,
    Memory,
    ModelClass,
    IAgentRuntime,
} from "@ai16z/eliza";
import { composeContext, generateText, generateMessageResponse } from "@ai16z/eliza";
import { ClientBase } from "./base";
import * as path from "path";

import dotenv from "dotenv";

dotenv.config();

const TWEETS_FILE = "tweets.json";

export const watcherCompletionFooter = `\nResponse format should be formatted in a JSON block like this:
[
  { "token": "{{token}}", "category": {{category}}, "count": {{count}} }
]
, and no other text should be provided.`;

export const watcherDetailTemplate =
    // {{goals}}
    `# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

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

# Instructions: Please find all the Web3 Token/Project that appear in the texts provided to you, and these tokens/projects should be created less than 1 year，and give the information to these Token/Projects, including one-sentence introduction, number of Twitter fans, Twitter popularity. And in the tweets, find the interactions with some accounts (referring to mentions, likes, reposts, posts, etc.). If there is interaction with [@jessepollak, @elonmusk, @cz_binance], it is marked as [Level 1], if there is interaction with [@aeyakovenko, @heyibinance, @CryptoHayes,@rajgokal], it is marked as [Level 2]; if there is interaction with [@jayendra_jog, @SaturnXSolana, @therealchaseeb, @jacobvcreech], it is marked as [Level 3]. In addition, provide the number of interactions with each level for each Token/Project, and find its relevant data from https://gmgn.ai/ for each Token/Project. Please provide the tokens by list and formated table.
` + watcherCompletionFooter;


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
Please find the token/project involved according to the text provided, and obtain the data of the number of interactions between each token and the three types of accounts (mentions/likes/comments/reposts/posts) in the tweets related to these tokens; mark the tokens as category 1, category 2 or category 3; if there are both category 1 and category 2, choose category 1, which has a higher priority. Please reply in Chinese and in the following format:
- Token Symbol by json name 'token';
- Token Interaction Category by json name 'category';
- Token Interaction Count by json name 'count';
Use the list format and only provide these 3 pieces of information.
` + watcherCompletionFooter;

const GEN_TOKEN_REPORT_DELAY = 1000 * 60 * 60;
const TWEET_TIMELINE = 60 * 60 * 6;
const CACHE_KEY_TWITTER_WATCHER = "twitter_watcher_data";
const CACHE_KEY_DATA_ITEM = "001";

export class TwitterWatchClient {
    client: ClientBase;
    runtime: IAgentRuntime;

    private respondedTweets: Set<string> = new Set();
    //private cache: NodeCache;  
    private cacheKey: string = CACHE_KEY_TWITTER_WATCHER;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        //this.cache = new NodeCache({ stdTTL: 3000 }); // 50 minutes cache
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
        // Check in-memory cache first
        //const cachedData = this.cache.get<T>(key);
        //if (cachedData) {
        //    return cachedData;
        //}

        // Check file-based cache
        const fileCachedData = await this.readFromCache<T>(key);
        if (fileCachedData) {
            // Populate in-memory cache
            //this.cache.set(key, fileCachedData);
            return fileCachedData;
        }

        return null;
    }

    private async setCachedData<T>(cacheKey: string, data: T): Promise<void> {
        // Set in-memory cache
        //this.cache.set(cacheKey, data);

        // Write to file-based cache
        await this.writeToCache(cacheKey, data);
    }

    async start() {
        if (!this.client.profile) {
            await this.client.init();
        }
        const genReportLoop = async () => {
            const lastGen = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>(
                "twitter/" +
                    this.runtime.getSetting("TWITTER_USERNAME") +
                    "/lastGen"
            );

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
        let fetchedTokens = new Map();

        try {
            const currentTime = new Date();
            const timeline = Math.floor(currentTime.getTime() / 1000) - TWEET_TIMELINE;
            for (const kolList of [TW_KOL_1, TW_KOL_2, TW_KOL_3]) {
                let twText = "";
                let kolTweets = [];
                for (const kol of kolList) {
                    console.log(kol.substring(1));
                    let tweets = await this.client.twitterClient.getTweetsAndReplies(kol.substring(1), 60);
                    // Fetch and process tweets
                    for await (const tweet of tweets) {
                        if (tweet.timestamp < timeline) {
                            continue; // Skip the outdates.
                        }
                        kolTweets.push(tweet);
                        twText = twText.concat("START_OF_TWEET_TEXT: [" + tweet.text + "] END_OF_TWEET_TEXT");
                    }
                }
                console.log(twText.length);


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
            
Please find the token/project involved according to the text provided, and obtain the data of the number of interactions between each token and the three types of accounts (mentions/likes/comments/reposts/posts) in the tweets related to these tokens; mark the tokens as category 1, category 2 or category 3; if there are both category 1 and category 2, choose category 1, which has a higher priority. Please reply in Chinese and in the following format:
- Token Symbol by json name 'token';
- Token Interaction Category by json name 'category';
- Token Interaction Count by json name 'count';
Use the list format and only provide these 3 pieces of information.`
 + watcherCompletionFooter;

                let response = await generateText({
                    runtime: this.runtime,
                    context: prompt,
                    modelClass: ModelClass.MEDIUM,
                });
                console.log(response);
                response = response.replaceAll("```", "");
                response = response.replace("json", "");
                let jsonArray = JSON.parse(response);
                console.log(jsonArray);
                if (jsonArray) {
                    // Merge results
                    jsonArray.forEach(item => {
                        const existingItem = fetchedTokens.get(item.token);
                        if (existingItem) {
                          // Merge category & count
                          existingItem.category = Math.min(existingItem.category, item.category);
                          existingItem.count += item.count;
                        } else {
                          fetchedTokens.set(item.token, { ...item });
                        }
                    });
                }
            }
            const obj = Object.fromEntries(fetchedTokens);
            const json = JSON.stringify(obj);
            this.setCachedData(CACHE_KEY_DATA_ITEM, json);
        } catch (error) {
            console.error("An error occurred:", error);
        }
        return fetchedTokens;
    }
}
