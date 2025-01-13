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
    agentCfg?: {
        enabled: boolean;
        interval: string;
        imitate: string;
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
    getAllWatchList(): Promise<string[]>;

    // Save user profile data
    saveUserData(profile: UserProfile);

    getAllUserProfiles(): Promise<UserProfile[]>;
}

export class UserManager implements UserManageInterface {
    static ALL_USER_IDS: string = "USER_PROFILE_ALL_IDS_";
    idSet = new Set();

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

    async getAllWatchList(): Promise<string[]> {
        let watchList = new Set<string>();
        // Get All ids
        for (const userid of this.idSet.keys()) {
            let userProfile = await this.getCachedData<UserProfile>(userid as string);
            if (userProfile) {
                for (const watchItem of userProfile.twitterWatchList) {
                    watchList.add(watchItem.username);
                }
            }
        }
        return Array.from(watchList);
    }

    //
    async verifyExistingUser(
        userId: string
    ): Promise<UserProfile> {
        const resp = await this.getCachedData<UserProfile>(userId);
        return resp;
    }

    async saveUserData(
        profile: UserProfile
    ) {
        await this.setCachedData(profile.userId, profile);
        let idsStr = await this.getCachedData(UserManager.ALL_USER_IDS) as string;
        let ids = new Set(JSON.parse(idsStr));
        ids.add(profile.userId);
        await this.setCachedData(UserManager.ALL_USER_IDS, JSON.stringify(Array.from(ids)));
        this.idSet = ids;
    }

    // Add this new method to the class
    async getAllUserProfiles(): Promise<UserProfile[]> {
    // Get all user IDs
    const idsStr = await this.getCachedData(UserManager.ALL_USER_IDS) as string;
    if (!idsStr) {
        return [];
    }

    // Parse IDs array
    const ids = JSON.parse(idsStr);

    // Fetch all profiles using Promise.all for parallel execution
    const profiles = await Promise.all(
        ids.map(async (userId: string) => {
            return await this.getCachedData(userId) as UserProfile;
        })
    );

        // Filter out any null/undefined profiles
       return profiles.filter(profile => profile != null);
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
            agentCfg :  {enabled: true, interval: "24h", imitate: "elonmusk"},
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
    async isWatched(userId: string, twUsername: string): Promise<boolean> {
        const profile = await this.getCachedData<UserProfile>(userId);
        if (profile) {
            return profile.twitterWatchList.some(item => item.username === twUsername);
        } else {
            return false;
        }
    }
}
