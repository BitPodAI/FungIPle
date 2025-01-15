import {
    TW_KOL_1,
    UserManager,
    ConsensusProvider,
    InferMessageProvider,
} from "@ai16z/plugin-data-enrich";
import {
    elizaLogger,
    generateText,
    IAgentRuntime,
    ModelClass,
    settings,
} from "@ai16z/eliza";
import { ClientBase } from "./base";
import { TwitterApi } from 'twitter-api-v2';

const WATCHER_INSTRUCTION = `
Please find the following data according to the text provided in the following format:
 (1) Token Symbol by json name "token";
 (2) Token Interaction Information by json name "interact";
 (3) Token Interaction Count by json name "count";
 (4) Token Key Event Description by json name "event".
The detail information of each item as following:
 The (1) item is the token/coin/meme name involved in the text provided.
 The (2) item include the interactions(mention/like/comment/repost/post/reply) between each token/coin/meme and the twitter account, the output is "@somebody mention/like/comment/repost/post/reply @token, @someone post @token, etc."; providing at most 2 interactions is enough.
 The (3) item is the data of the count of interactions between each token and the twitter account.
 The (4) item is the about 30 words description of the involved event for each token/coin/meme. If the description is too short, please attach the tweets.
Please skip the top token, such as btc, eth, sol, base, bnb.
Use the list format and only provide these 4 pieces of information.`;

export const watcherCompletionFooter = `\nResponse format should be formatted in a JSON block like this:
[
  { "token": "{{token}}", "interact": {{interact}}, "count": {{count}}, "event": {{event}} }
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
${settings.AGENT_WATCHER_INSTRUCTION || WATCHER_INSTRUCTION}
` + watcherCompletionFooter;

const TWEET_COUNT_PER_TIME = 20;      //count related to timeline
const TWEET_TIMELINE = 60 * 60 * 2;   //timeline related to count
const GEN_TOKEN_REPORT_DELAY = 1000 * TWEET_TIMELINE;
const SEND_TWITTER_INTERNAL = 1000 * 60 * 60;

export class TwitterWatchClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    consensus: ConsensusProvider;
    inferMsgProvider: InferMessageProvider;
    userManager: UserManager;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.consensus = new ConsensusProvider(this.runtime);
        this.inferMsgProvider = new InferMessageProvider(
            this.runtime.cacheManager
        );
        this.userManager = new UserManager(this.runtime.cacheManager);
    }

    convertTimeToMilliseconds(timeStr: string): number {
        switch (timeStr) {
            case '1h':
                return 1 * 60 * 60 * 1000; // 1 hour in milliseconds
            case '2h':
                return 2 * 60 * 60 * 1000; // 2 hour in milliseconds
            case '3h':
                return 3 * 60 * 60 * 1000; // 3 hours in milliseconds
            case '12h':
                return 12 * 60 * 60 * 1000; // 12 hours in milliseconds
            case '24h':
                return 24 * 60 * 60 * 1000; // 24 hours in milliseconds
            default:
                return 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        }
    }
    generatePrompt(imitate: string, text: string): string {
        let prompt = "Here is your personality introduction and Twitter style, and Please imitate the style of the characters below and modify the Twitter content afterwards.Twitter content is after the keyword [Twitter]:";
        switch (imitate) {
            case 'elonmusk':
                prompt += "Elon Musk is known for his highly innovative and adventurous spirit, with a strong curiosity and drive for pushing boundaries.Elon’s tweets are direct and full of personality. He often posts short, humorous, and at times provocative content.";
                break;

            case 'cz_binance':
                prompt += "CZ is a pragmatic and calm entrepreneur, skilled in handling complex market issues.CZ's tweets are usually concise and informative, focusing on cryptocurrency news, Binance updates, and industry trends.";
                break;

            case 'aeyakovenko':
                prompt += "the founder of Solana, is seen as a highly focused individual who pays close attention to technical details.Yakovenko’s tweets are more technical, often discussing the future development of blockchain technologies, Solana's progress, and major industry challenges. ";
                break;

            case 'jessepollak':
                prompt += "Jesse Pollak is someone with a strong passion for technology and community. He is an active figure in the cryptocurrency community, especially in areas like technical development and user experience, and he has an innovative mindset.Jesse’s tweets are typically concise and easy to understand, showcasing his personal style.";
                break;

            case 'shawmakesmagic':
                prompt += "Shawn is a creative individual who enjoys exploring innovative projects and cutting-edge technologies.His tweets are generally creative, often sharing innovative applications of blockchain technology or topics related to magic, fantasy, and imagination.";
                break;

            case 'everythingempt':
                prompt += "Everythingempt is Openness,Conscientiousness,Extraversion,Agreeableness. Twitter's style is Minimalist,Customized Experience,Selective Content";
                break;

                default:
                    break;
        }
        prompt += "\n[Twitter]:";
        prompt += text;
        return prompt;
    }
    async runTask() {
        elizaLogger.log("Twitter Sender task loop");
        // const userManager = new UserManager(this.runtime.cacheManager);
        const userProfiles = await this.userManager.getAllUserProfiles();
        for (let i = 0; i < userProfiles.length; i++) {
            let userProfile = userProfiles[i];
            if(!userProfile.agentCfg || !userProfile.agentCfg.interval
                ||!userProfile.agentCfg.imitate) {
                    continue;
            }
            const {enabled, interval, imitate} = userProfile.agentCfg;
            if(!enabled) {
                continue;
            }
            const lastTweetTime = userProfile.tweetFrequency.lastTweetTime;
            if(Date.now() - lastTweetTime > this.convertTimeToMilliseconds(interval)) {
                userProfile.tweetFrequency.lastTweetTime = Date.now();
                userManager.saveUserData(userProfile);
                try {
                    let tweet = await InferMessageProvider.getAllWatchItemsPaginated(this.runtime.cacheManager);
                    if (tweet) {
                        const prompt = this.generatePrompt(imitate, JSON.stringify(tweet?.items[0]));
                        let response = await generateText({
                            runtime: this.runtime,
                            context: prompt,
                            modelClass: ModelClass.LARGE,
                        });
                    elizaLogger.log("Twitter Sender msg:" + tweet);
                    await this.sendTweet(response, userProfile);
                    } else {
                    elizaLogger.log("Twitter Sender msg is null, skip this time");
                    }
                } catch (error: any) {
                    elizaLogger.error("Twitter send err: ", error.message);
                }

            }
        }

    }
    intervalId: NodeJS.Timeout;

    async start() {
        console.log("TwitterWatcher start");
        if (!this.client.profile) {
            await this.client.init();
        }
        this.consensus.startNode();

        /*twEventCenter.on('MSG_SEARCH_TWITTER_PROFILE', async (data) => {
            console.log('Received message:', data);
            const profiles = await this.searchProfile(data.username, data.count);
            // Send back
            twEventCenter.emit('MSG_SEARCH_TWITTER_PROFILE_RESP', profiles);
        });*/
        this.intervalId = setInterval(() => this.runTask(), SEND_TWITTER_INTERNAL);
        // this.intervalId = setInterval(() => this.runTask(), 10000);
        const genReportLoop = async () => {
            elizaLogger.log("TwitterWatcher loop");
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
            //}, 60000);

            console.log(
                `Next tweet scheduled in ${GEN_TOKEN_REPORT_DELAY / 60 / 1000} minutes`
            );
        };
        genReportLoop();
    }

    async getKolList() {
        // TODO: Should be a unipool shared by all users.
        //return JSON.parse(settings.TW_KOL_LIST) || TW_KOL_1;
        // const userManager = new UserManager(this.runtime.cacheManager);
        return await this.userManager.getAllWatchList();
    }

    async searchProfile(username: string, count: number) {
        let profiles = [];

        try {
            const response = await this.client.twitterClient.searchProfiles(username, count);
            if (response ) {
                for await (const profile of response) {
                    profiles.push(profile);
                }
            }
        } catch (error) {
            console.error("searchProfile error:", error);
        }
        return profiles;
    }

    async fetchTokens() {
        let fetchedTokens = new Map();

        try {
            const currentTime = new Date();
            const timeline =
                Math.floor(currentTime.getTime() / 1000) - TWEET_TIMELINE - 60 * 60 * 24;
            const kolList = await this.getKolList();
            for (const kol of kolList) {
                let kolTweets = [];
                let tweets =
                    await this.client.twitterClient.getTweetsAndReplies(
                        kol, TWEET_COUNT_PER_TIME);
                // Fetch and process tweets
                try {
                    for await (const tweet of tweets) {
                        if (tweet.timestamp < timeline) {
                            continue; // Skip the outdates.
                        }
                        kolTweets.push(tweet);
                    }
                } catch (error) {
                    console.error("Error fetching tweets:", error);
                    console.log(`kol ${kol} not found`);
                    continue;
                }
                console.log(kolTweets.length);
                if (kolTweets.length < 1) {
                    continue;
                }

                const prompt =
                    `
                Here are some tweets/replied:
                    ${[...kolTweets]
                        .filter((tweet) => {
                            // ignore tweets where any of the thread tweets contain a tweet by the bot
                            const thread = tweet.thread;
                            const botTweet = thread.find(
                                (t) =>
                                    t.username ===
                                    this.runtime.getSetting("TWITTER_USERNAME")
                            );
                            return !botTweet;
                        })
                        .map(
                            (tweet) => `
                    From: ${tweet.name} (@${tweet.username})
                    Text: ${tweet.text}\n
                    Likes: ${tweet.likes}, Replies: ${tweet.replies}, Retweets: ${tweet.retweets},
                        `)
                        .join("\n")}
                ${settings.AGENT_WATCHER_INSTRUCTION || WATCHER_INSTRUCTION}` +
                watcherCompletionFooter;
                //console.log(prompt);

                let response = await generateText({
                    runtime: this.runtime,
                    context: prompt,
                    modelClass: ModelClass.LARGE,
                });
                console.log(response);
                await this.inferMsgProvider.addInferMessage(kol, response);
            }

            // Consensus for All Nodes
            let report = await InferMessageProvider.getLatestReport(
                this.runtime.cacheManager
            );
            await this.consensus.pubMessage(report);

            // try {
            //     let tweet = await InferMessageProvider.getAllWatchItemsPaginated(this.runtime.cacheManager);
            //     if (tweet) {
            //     elizaLogger.log("Twitter Sender2 msg:" + tweet);
            //     await this.sendTweet(JSON.stringify(tweet?.items[0]));
            //     } else {
            //     elizaLogger.log("Twitter Sender2 msg is null, skip this time");
            //     }
            // } catch (error: any) {
            //     elizaLogger.error("Twitter Sender2 err: ", error.message);
            // }
        } catch (error) {
            console.error("An error occurred:", error);
        }
        return fetchedTokens;
    }

    async sendReTweet(tweed: string, userId: any) {
        //const userManager = new UserManager(this.runtime.cacheManager);
        const profile = await this.userManager.verifyExistingUser(userId);
        this.sendTweet(tweed, profile);
    }

    async sendTweet(tweet: string, cached: any) {
        try {
            // Parse the tweet object
            //const tweetData = JSON.parse(tweet || `{}`);
            const tweetData = JSON.parse(tweet || `{}`);

            //const cached = await this.runtime.cacheManager.get("userProfile");
            if (cached) {
                // Login with v2
                const profile = JSON.parse(cached);
                if (profile.tweetProfile.accessToken) {
                    // New Twitter API v2 by access token
                    const twitterClient = new TwitterApi(profile.tweetProfile.accessToken);

                    // Check if the client is working
                    const me = await twitterClient.v2.me();
                    console.log('OAuth2 Success:', me.data);
                    if (me.data) {
                        const tweetResponse = await twitterClient.v2.tweet({text: tweetData.text});
                        console.log('Tweet result:', tweetResponse);
                    }

                    // Login with v2
                    /*const auth = new TwitterGuestAuth(bearerToken);
                    auth.loginWithV2AndOAuth2(profile.tweetProfile.accessToken);
                    const v2Client = auth.getV2Client();
                    if (v2Client) {
                        const me = await v2Client.v2.me();
                        console.log('OAuth2 Success:', me.data);
                        createCreateTweetRequestV2(tweetData.text, auth);
                    }*/
                    return;
                }
            }

            // Send the tweet self if no OAuth2
            const result = await this.client.requestQueue.add(
                async () =>
                    await this.client.twitterClient.sendTweet(
                        tweetData?.text || ""
                    )
            );
            console.log("Tweet result:", result);
        } catch (error) {
            console.error("sendTweet error: ", error);
        }
    }
}
