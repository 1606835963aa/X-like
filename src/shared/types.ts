export type Source = 'bookmark' | 'like';
export type Media = { type: 'photo' | 'video' | 'gif'; url: string; thumbnail: string; localPath?: string };
export type PostInput = {
  id: string; text: string; author: string; authorName: string; avatar?: string;
  publishedAt: string | null; url: string; media: Media[];
  quote?: { id: string; text: string; author: string; authorName: string };
  metrics?: { likes?: number; reposts?: number; replies?: number };
  hashtags?: string[];
};
export type Post = PostInput & {
  firstSeenAt: string; updatedAt: string; note: string; tags: string[]; hashtags: string[]; folder: string;
  read: boolean; pinned: boolean; archived: boolean; sources: Source[]; accountIds: string[];
};
export type Query = {
  q?: string; source?: string; media?: string; tag?: string; folder?: string;
  from?: string; to?: string; dateField?: string; author?: string; authorId?: string; sort?: string; seed?: string;
  read?: string; pinned?: string; archived?: string; account?: string; page?: string; limit?: string;
};
export type Connection = { url: string; token: string; name?: string; local?:boolean };
export type SyncState = { running: boolean; source?: Source; count: number; message: string; state: 'idle'|'login'|'running'|'waiting'|'complete'|'stopped'|'error'; jobId?: string };
export type Account = { id: string; handle: string; name: string; avatar?: string };
export type Author = { id:string; handle:string; name:string; avatar:string; count:number; videos:number; bookmarks:number; likes:number };
export type Stats = { total: number; bookmarks: number; likes: number; unread: number; pinned: number; archived: number; photos: number; videos: number; tags: { name: string; count: number }[]; authors: Author[]; folders: { name: string; count: number }[]; accounts: Account[]; lastSync: any; };
export type DesktopBridge = {
  preferences:Record<string,string>;savePreference:(key:string,value:string)=>Promise<void>;
  platform: string; connection: () => Promise<Connection>; savedRemote: () => Promise<Connection | null>; saveConnection: (c: Connection | null) => Promise<Connection>;
  xStatus: () => Promise<{ connected: boolean; account: Account | null }>; loginX: () => Promise<void>;
  sync: (options: { connection: Connection; sources: Source[]; mode: 'recent'; background?:boolean; automatic?:boolean }) => Promise<void>;
  stopSync: () => Promise<void>; onSync: (callback: (s: SyncState) => void) => () => void;
  logoutX: () => Promise<void>; openExternal: (url: string) => Promise<void>;
  saveVideos: (ids:string[]) => Promise<{saved:number;failed:number;total:number}>;
  saveFile: (options: { name: string; data: string; encoding?: 'utf8'|'base64' }) => Promise<boolean>;
};
declare global { interface Window { shizang?: DesktopBridge; } }
