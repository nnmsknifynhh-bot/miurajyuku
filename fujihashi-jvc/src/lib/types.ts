export type ID = string;

/** 「要確認」= 未確定の値。null は未設定（要確認）を表す */
export const NEEDS_REVIEW = '要確認';

export type DueRule = 'targetMonthEnd' | 'distributionMonthEnd';

export interface Settings {
  teamName: string;
  recorderName: string;
  fiscalStartMonth: number;
  /** 交通費（高速利用あり） */
  fareHighwayPlayer: number;
  fareHighwayParent: number;
  fareDriver: number;
  /** 交通費（高速利用なし） */
  fareNoHighway: number;
  /** 基準車両に乗る指導者名（例: 先野） */
  referencePerson: string;
  /** 当番準備金の初期値（null = 要確認・毎回入力） */
  prepDefault: number | null;
  /** 月謝の初期値（null = 要確認） */
  monthlyFeeDefault: number | null;
  /** 月謝の回収期限ルール（要確認のため選択式） */
  feeDueRule: DueRule;
  autoLockMinutes: number;
  apiToken: string;
  closedThrough?: string;
}

export interface Child { id: ID; name: string; grade?: string }

/** 月謝は家庭単位 */
export interface Household {
  id: ID;
  name: string; // 例: 三浦家
  guardian: string; // 例: 三浦母
  children: Child[];
  monthlyFee: number | null; // null = 要確認
  active: boolean;
  note?: string;
}

export interface FeeCollection { id: ID; date: string; amount: number; txId: ID }

export interface FeeBill {
  id: ID;
  householdId: ID;
  month: string; // 対象月 YYYY-MM
  amount: number;
  distributedOn?: string; // 月謝袋の配布日
  dueDate: string;
  collections: FeeCollection[];
  note?: string;
}

export interface Activity { id: ID; name: string; venue: string }

export interface DutyPrep {
  id: ID;
  name: string; // 当番氏名
  amount: number | null; // 準備金（null = 要確認）
  handedTxId?: ID; // 渡した記録（日付・金額は出納帳の取引）
  cancelled?: boolean;
  note?: string;
}

export type Role = 'driver' | 'player' | 'parent' | 'other';

export interface Rider {
  id: ID;
  name: string;
  role: Role;
  childId?: ID; // 名簿の選手
  householdId?: ID;
  amountOverride?: number; // 個別の金額（例外）
  txId?: ID; // 集金済み（集金日は取引日）
}

export interface Car { id: ID; name: string; riders: Rider[] } // 運転手も role=driver で含む

export interface DriverPayment { id: ID; driverName: string; amountOverride?: number; txId?: ID }

export interface DriverPay {
  refCarId?: ID; // 基準車両
  distanceKm?: number;
  gasYen?: number; // 当面は手入力
  tollRoundTripYen?: number;
  confirmed: boolean;
  payments: DriverPayment[];
}

export interface DayPage {
  id: ID;
  date: string;
  activities: Activity[];
  duties: DutyPrep[];
  usesHighway: boolean | null; // null = 要確認
  cars: Car[];
  carSource?: string;
  driverPay: DriverPay;
  notes?: string;
  review: string[]; // 要確認メモ
  history: { at: string; text: string }[];
}

export type ExpenseCategory = 'drink' | 'bento' | 'equipment' | 'other';
export type Funding = 'advance' | 'self'; // 事前渡し金から / 立て替え

export interface Expense {
  id: ID;
  date: string; // 購入日
  purchaser: string;
  items: string;
  category: ExpenseCategory;
  amount: number;
  funding: Funding;
  dayId?: ID; // 関連する活動日（備品は無くても可）
  receiptIds: ID[]; // 暗号化保存した画像
  settleTxId?: ID; // 立て替え分の支払い
  review: string[];
  createdAt: string;
}

/** 事前渡し金の差額精算（活動日 × 人） */
export interface PrepSettlement { id: ID; dayId: ID; person: string; txId?: ID; diff: number; at: string }

export type TxCategory = 'fee' | 'transport' | 'driver' | 'prep' | 'prepSettle' | 'expense' | 'opening' | 'other';

export interface TxRelated { kind: 'fee' | 'day' | 'expense'; id: ID; subId?: ID }

export interface TxRevision {
  at: string;
  by: string;
  reason: string;
  before: Pick<Tx, 'date' | 'counterparty' | 'amount' | 'direction' | 'description' | 'category'>;
}

export interface Tx {
  id: ID;
  date: string;
  counterparty: string;
  amount: number;
  direction: 'in' | 'out';
  category: TxCategory;
  description: string;
  related?: TxRelated;
  sourceKey?: string;
  recorder: string;
  createdAt: string;
  voided?: { at: string; by: string; reason: string };
  revisions: TxRevision[];
}

export interface AppData {
  version: 2;
  settings: Settings;
  households: Household[];
  bills: FeeBill[];
  days: DayPage[];
  expenses: Expense[];
  prepSettlements: PrepSettlement[];
  txs: Tx[];
}
