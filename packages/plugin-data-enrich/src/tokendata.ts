import { IAgentRuntime, Memory, Provider, State } from "@ai16z/eliza";
import { ICacheManager, settings } from "@ai16z/eliza";
import * as path from "path";


// Pre Defined TOP Token
export const TOP_TOKEN = [
    "BTC",
    "ETH",
    "SOL",
    "BNB",
    "DOT",
];

const PROVIDER_CONFIG = {
    BIRDEYE_API: "https://public-api.birdeye.so",
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    TOKEN_SECURITY_ENDPOINT: "/defi/token_security?address=",
    TOKEN_TRADE_DATA_ENDPOINT: "/defi/v3/token/trade-data/single?address=",
};

export interface TokenSecurityData {
    ownerBalance: string;
    creatorBalance: string;
    ownerPercentage: number;
    creatorPercentage: number;
    top10HolderBalance: string;
    top10HolderPercent: number;
}

export class TokenDataProvider {
    private cacheKey: string = "data-enrich/tokens";

    constructor(
        private cacheManager: ICacheManager
    ) {
    }

    private async readFromCache<T>(key: string): Promise<T | null> {
        const cached = await this.cacheManager.get<T>(
            path.join(this.cacheKey, key)
        );
        return cached;
    }

    private async writeToCache<T>(key: string, data: T): Promise<void> {
        await this.cacheManager.set(path.join(this.cacheKey, key), data, {
            expires: Date.now() + 5 * 60 * 1000,
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

    private async fetchWithRetry(
        url: string,
        options: RequestInit = {}
    ): Promise<any> {
        let lastError: Error;

        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        Accept: "application/json",
                        "x-chain": "solana",
                        "X-API-KEY": settings.BIRDEYE_API_KEY || "",
                        ...options.headers,
                    },
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(
                        `HTTP error! status: ${response.status}, message: ${errorText}`
                    );
                }

                const data = await response.json();
                return data;
            } catch (error) {
                console.error(`Attempt ${i + 1} failed:`, error);
                lastError = error as Error;
                if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
                    const delay = PROVIDER_CONFIG.RETRY_DELAY * Math.pow(2, i);
                    console.log(`Waiting ${delay}ms before retrying...`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
            }
        }

        console.error(
            "All attempts failed. Throwing the last error:",
            lastError
        );
        throw lastError;
    }

    async fetchTokenSecurity(tokenSymbol: string): Promise<TokenSecurityData> {
        console.log(tokenSymbol);
        const url = `${PROVIDER_CONFIG.BIRDEYE_API}${PROVIDER_CONFIG.TOKEN_SECURITY_ENDPOINT}${tokenSymbol}`;
        const data = await this.fetchWithRetry(url);
        console.log(data);

        if (!data?.success || !data?.data) {
            throw new Error("No token security data available");
        }

        const security: TokenSecurityData = {
            ownerBalance: data.data.ownerBalance,
            creatorBalance: data.data.creatorBalance,
            ownerPercentage: data.data.ownerPercentage,
            creatorPercentage: data.data.creatorPercentage,
            top10HolderBalance: data.data.top10HolderBalance,
            top10HolderPercent: data.data.top10HolderPercent,
        };
        console.log(`Token security data cached for ${tokenSymbol}.`);

        return security;
    }


    formatTokenData(tokenSymbol: string, data: TokenSecurityData): string {
        let output = `**Token Security Report**\n`;
        output += `Token Address: ${tokenSymbol}\n\n`;

        // Security Data
        output += `**Ownership Distribution:**\n`;
        output += `- Owner Balance: ${data.ownerBalance}\n`;
        output += `- Creator Balance: ${data.creatorBalance}\n`;
        output += `- Owner Percentage: ${data.ownerPercentage}%\n`;
        output += `- Creator Percentage: ${data.creatorPercentage}%\n`;
        output += `- Top 10 Holders Balance: ${data.top10HolderBalance}\n`;
        output += `- Top 10 Holders Percentage: ${data.top10HolderPercent}%\n\n`;
        output += `\n`;

        console.log("Formatted token data:", output);
        return output;
    }

    async getFormattedTokenSecurityReport(tokenSymbol: string): Promise<string> {
        try {
            console.log("Generating formatted token security report...");
            const processedData = await this.fetchTokenSecurity(tokenSymbol);
            return this.formatTokenData(tokenSymbol, processedData);
        } catch (error) {
            console.error("Error generating token security report:", error);
            return "Unable to fetch token information. Please try again later.";
        }
    }
}

const tokendataProvider: Provider = {
    get: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => {
        try {
            const provider = new TokenDataProvider(
                _runtime.cacheManager
            );
            let tokenSymbol = _message?.content?.text;

            return provider.getFormattedTokenSecurityReport(tokenSymbol);
        } catch (error) {
            console.error("Error fetching token data:", error);
            return "Unable to fetch token information. Please try again later.";
        }
    },
};
export { tokendataProvider };
