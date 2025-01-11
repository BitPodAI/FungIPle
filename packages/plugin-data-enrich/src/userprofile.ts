import { ICacheManager, settings } from "@ai16z/eliza";

interface WatchItem {
    username: string;
    tabs: [];
}

interface UserProfile {
    userId: string;
    username: string;
    email: string;
    avatar?: string;
    bio?: string | string[];
    walletAddress?: string;
    level: number;
    experience: number;
    nextLevelExp: number;
    points: number;
    tweetProfile?: {
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
    updateProfile(userId: string, profile: UserProfile);

    // Update WatchList for spec user
    updateWatchList(userId: string, list: WatchItem[]): void;

    // Get the watchlist for all users, and identified.
    getAllWatchList(): string[];

    // Save user profile data
    saveUserData();
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

    updateProfile(userId: string, profile: UserProfile) {
        throw new Error("Method not implemented.");
    }

    updateWatchList(userId: string, list: WatchItem[]): void {
        throw new Error("Method not implemented.");
    }

    getAllWatchList(): string[] {
        throw new Error("Method not implemented.");
    }

    saveUserData() {
        throw new Error("Method not implemented.");
    }
    
}