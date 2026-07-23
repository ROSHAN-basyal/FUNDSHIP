export type User = {
  id: string;
  credentialId: string;
  name: string;
  phone?: string;
  avatarColor: string;
  profilePhoto?: string;
  mustChangePassword?: boolean;
  role?: 'admin' | 'member';
};

export type Poll = {
  id: string;
  title: string;
  eventAt: string;
  bsDate: string;
  minYes: number;
  deadlineAt: string;
  status: 'open' | 'confirmed' | 'cancelled';
  approvalStatus: 'approved' | 'pending';
  creatorName: string;
  creatorId: string;
  pollType: 'yes_no' | 'options';
  options: { id:string; label:string }[];
  winningOptions: string[];
  voteDetails: { userId:string; name:string; avatarColor:string; choice:string; createdAt:string }[];
  canDelete: boolean;
  yesCount: number;
  noCount: number;
  declineCount: number;
  myVote?: string;
};

export type Message = {
  id: string;
  userId: string;
  name: string;
  avatarColor: string;
  body: string;
  createdAt: string;
};

export type Group = {
  id: string;
  name: string;
  emoji: string;
  accent: string;
  role: 'admin' | 'member';
  members: User[];
  polls: Poll[];
  messages: Message[];
};

export type Payment = {
  id: string;
  initiatorId: string;
  initiatorName: string;
  payerId: string;
  payerName: string;
  payerColor: string;
  payeeId: string;
  payeeName: string;
  payeeColor: string;
  amount: number;
  purpose: string;
  note?: string;
  kind: 'lend' | 'split';
  splitId?: string;
  splitCount?: number;
  totalAmount?: number;
  status: 'pending' | 'verified';
  createdAt: string;
};

export type LedgerItem = { personId: string; name: string; avatarColor: string; amount: number };

export type AppNotification = {
  id: string;
  type: 'payment_request' | 'poll_open' | 'poll_approval' | 'poll_result' | 'event_due' | 'group_invite' | 'connection_request' | 'connection_accepted';
  title: string;
  body: string;
  entityId: string;
  persistentUntil?: string;
  read: boolean;
  nativeDelivered: boolean;
  canClear: boolean;
  createdAt: string;
};

export type ConnectionRequest = {
  id: string;
  requester: User;
  outgoing: boolean;
  createdAt: string;
};

export type Bootstrap = {
  user: User;
  people: User[];
  groups: Group[];
  groupInvites: { id:string; groupId:string; groupName:string; emoji:string; accent:string; inviterName:string; createdAt:string }[];
  payments: { incoming: Payment[]; outgoing: Payment[] };
  transactions: Payment[];
  ledger: LedgerItem[];
  totals: { owedToYou: number; youOwe: number };
  connections: (User & { connectedAt:string })[];
  connectionRequests: ConnectionRequest[];
  notifications: AppNotification[];
};
