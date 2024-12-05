import { IAgentRuntime, Memory, Provider, State } from "@ai16z/eliza";
import { Scraper } from "agent-twitter-client";
import { messageCompletionFooter } from "@ai16z/eliza";
import dotenv from "dotenv";
//import fs from "fs";

dotenv.config();

const TWEETS_FILE = "tweets.json";

// Pre Defined Twitter KOL
export const TW_KOL_1 = [
    "@jessepollak",
    "@elonmusk",
    "@cz_binance",
];

export const TW_KOL_2 = [
    "@aeyakovenko",
    "@heyibinance",
    "@CryptoHayes",
    "@rajgokal",
];

export const TW_KOL_3 = [
    "@jayendra_jog",
    "@therealchaseeb",
    "@jacobvcreech",
    "@gavofyork",
];


export const socialProvider: Provider = {
    get: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => {
        const currentDate = new Date();

        return `The Twitter KOL List Category 1 is ${TW_KOL_1},
                The Twitter KOL List Category 2 is ${TW_KOL_2},
                The Twitter KOL List Category 3 is ${TW_KOL_3}.
                Please use this as your reference for any twitter-based operations or responses.`;
    },
}

export class twitterDataProvider {

    async fetchTwitterProfile(username: string): Promise<string> {
        try {
            // Create a new instance of the Scraper
            const scraper = new Scraper();

            // Check if login was successful
            if (!await scraper.isLoggedIn()) {
                // Log in to Twitter using the configured environment variables
                await scraper.login(
                    process.env.TWITTER_USERNAME,
                    process.env.TWITTER_PASSWORD,
                    process.env.TWITTER_EMAIL,
                    process.env.TWITTER_2FA_SECRET || undefined
                );

                console.log("Logged in successfully!");
            }

            // Check if login was successful
            if (await scraper.isLoggedIn()) {
                const profile = await scraper.getProfile(username);
                // Log out from Twitter
                await scraper.logout();
                console.log("Logged out successfully!");
                return `The twitter fans of ${username} is ${profile.followersCount}`;
            } else {
                console.log("Login failed. Please check your credentials.");
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
        return `The twitter fans of ${username} is unknown`;
    }

};
