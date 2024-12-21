// The define of AI Infer Message
import { ICacheManager } from "@ai16z/eliza";
import { TokenDataProvider, TOP_TOKENS } from "./tokendata.ts";
import * as path from "path";


var TokenAlphaReport = [];
var TokenAlphaText = "";
const TOKEN_REPORT: string = "_token_report";
const TOKEN_ALPHA_TEXT: string = "_token_alpha_text";

//{ "token": "{{token}}", "category": {{category}}, "count": {{count}}, "event": {{event}} }
interface InferMessage {
    token: string;
    category: number;
    count: number;
    event: Text;
}

export class InferMessageProvider {
    private static cacheKey: string = "data-enrich/infermessage";

    constructor(
        private cacheManager: ICacheManager
    ) {
    }

    private async readFromCache<T>(key: string): Promise<T | null> {
        const cached = await this.cacheManager.get<T>(
            path.join(InferMessageProvider.cacheKey, key)
        );
        return cached;
    }

    private async writeToCache<T>(key: string, data: T): Promise<void> {
        await this.cacheManager.set(path.join(InferMessageProvider.cacheKey, key), data, {
            expires: Date.now() + 3 * 24 * 60 * 60 * 1000,
        });
    }

    private async getCachedData<T>(key: string): Promise<T | null> {
        const fileCachedData = await this.readFromCache<T>(key);
        if (fileCachedData) {
            return fileCachedData;
        }

        return null;
    }

    private async setCachedData<T>(cacheKey: string, data: T): Promise<void> {
        await this.writeToCache(cacheKey, data);
    }

    async addInferMessage(input: string) {
        try {
            input = input.replaceAll("```", "");
            input = input.replace("json", "");
            let jsonArray = JSON.parse(input);
            console.log(`addInferMessage: ${jsonArray}`);
            if (jsonArray) {
                TokenAlphaReport = [];
                TokenAlphaText = "";
                var category = 4;
                // Merge results
                jsonArray.forEach(async item => {
                    const existingItem = await this.getCachedData<InferMessage>(item.token);
                    if (existingItem) {
                        // Merge category & count
                        item.category = Math.min(existingItem.category, item.category);
                        item.count += existingItem.count;
                        this.setCachedData(item.token, { ...item });
                        TokenAlphaReport.push(item);
                    } else {
                        if (!TOP_TOKENS.includes(item.token)) {
                            this.setCachedData(item.token, { ...item });
                            TokenAlphaReport.push(item);
                        }
                    }
                    console.log(item);
                    if (item.category < category) {
                        category = item.category;
                        let baseInfo = TokenDataProvider.fetchTokenInfo(item.token);
                        console.log(baseInfo);
                        TokenAlphaText = `${item.token}: ${item.event} \n${baseInfo}`;
                    }
                });
                this.setCachedData(TOKEN_REPORT, TokenAlphaReport);
                this.setCachedData(TOKEN_ALPHA_TEXT, TokenAlphaText);
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
    }

    static async getLatestReport(cacheManager: ICacheManager) {
        try {
            const report = await cacheManager.get<[InferMessage]>(
                path.join(InferMessageProvider.cacheKey, TOKEN_REPORT)
            );
            if (report) {
                try {
                    const json = JSON.stringify(report);
                    if (json) {
                        return json;
                    }
                } catch (error) {
                    console.error("Error fetching token data: ", error);
                }
                return report;
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
        return [];
    }

    static async getReportText(cacheManager: ICacheManager) {
        try {
            const report = await cacheManager.get<[InferMessage]>(
                path.join(InferMessageProvider.cacheKey, TOKEN_REPORT)
            );
            if (report) {
                try {
                    if (typeof report === "object") {
                        let item = report[0];
                        return `${item.token} is mentioned ${item.count} times, ${item.event}`;
                    }
                } catch (error) {
                    console.error("Error fetching token data: ", error);
                }
                return report;
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
        return "";
    }

    async getAlphaText() {
        try {
            const text = await this.getCachedData<string>(TOKEN_ALPHA_TEXT);
            if (text) {
                return text;
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
        return "";
    }
}