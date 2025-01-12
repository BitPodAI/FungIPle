import { ICacheManager } from "@ai16z/eliza";

interface WatchItem {
    username: string;
    tags: [];
}

export interface UserProfile {
    userId: string;
    gmail?: string;
    agentname: string;
    bio?: string | string[];
    walletAddress?: string;
    level: number;
    experience: number;
    nextLevelExp: number;
    points: number;
    tweetProfile?: {
        username: string;
        email: string;
        avatar?: string;
        code: string;
        codeVerifier: string;
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    };
    twitterWatchList: WatchItem[];
    tweetFrequency: {
        dailyLimit: number;
        currentCount: number;
        lastTweetTime?: number;
    };
    stats: {
        totalTweets: number;
        successfulTweets: number;
        failedTweets: number;
    };
    style?: {
        all: string[];
        chat: string[];
        post: string[];
    };
    adjectives?: string[];
    lore?: string[];
    knowledge?: string[];
    topics?: string[];
}

interface UserManageInterface {
    // Update profile for spec user
    updateProfile(profile: UserProfile);

    // Update WatchList for spec user
    updateWatchList(userId: string, list: WatchItem[]): void;

    // Get the watchlist for all users, and identified.
    getAllWatchList(): string[];

    // Save user profile data
    saveUserData(profile: UserProfile);
}

export class UserManager implements UserManageInterface {
    constructor(
        private cacheManager: ICacheManager
    ) {
    }

    private async readFromCache<T>(key: string): Promise<T | null> {
        const cached = await this.cacheManager.get<T>(key);
        return cached;
    }

    private async writeToCache<T>(key: string, data: T): Promise<void> {
        await this.cacheManager.set(key, data, {expires: 0}); //expires is NEED
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

    async updateProfile(profile: UserProfile) {
        await this.setCachedData(profile.userId, profile);
    }

    updateWatchList(userId: string, list: WatchItem[]): void {
        throw new Error("Method not implemented.");
    }

    getAllWatchList(): string[] {
        throw new Error("Method not implemented.");
    }

    // 
    async verifyExistingUser(
        userId: string
    ): Promise<{ profile: UserProfile }> {
        return await this.getCachedData(userId);
    }

    async saveUserData(
        profile: UserProfile
    ) {
        await this.setCachedData(profile.userId, profile);
    }

    createDefaultProfile(userId: string, gmail?: string): UserProfile {
        return {
            userId,
            gmail: gmail,
            agentname: "pod",
            bio: "",
            level: 1,
            experience: 0,
            nextLevelExp: 1000,
            points: 0,
            tweetProfile: {
                username: "",
                email: "",
                avatar: "",
                code: "",
                codeVerifier: "",
                accessToken: "",
                refreshToken: "",
                expiresIn: 0,
            },
            twitterWatchList: [],
            tweetFrequency: {
                dailyLimit: 10,
                currentCount: 0,
                lastTweetTime: Date.now(),
            },
            stats: {
                totalTweets: 0,
                successfulTweets: 0,
                failedTweets: 0,
            },
        };
    }

    // Check whether the profile is watched
    async isWatched(userId: string, twUsername: string) {
        const profile = await this.getCachedData<UserProfile>(userId);
        return profile.twitterWatchList.some(item => item.username === twUsername);
    }
}