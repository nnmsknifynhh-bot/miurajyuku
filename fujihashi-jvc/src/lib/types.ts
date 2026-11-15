export type ID = string;

export type GasMethod = 'perKm' | 'fuel';

export interface Settings {
  teamName: string;
  recorderName: string;
  defaultMonthlyFee: number;
  feeDueDay: number;
  feeStartMonth: string; // YYYY-MM 自動生成の開始月
  fiscalStartMonth: number; // 4 = 4月始まり
  dutyDefaultAmount: number;
  gas: { method: GasMethod; yenPerKm: number; kmPerL: number; yenPerL: number; roundTrip: boolean };
  reminders: {
    feeDaysBefore: number;
    transportDaysBefore: number;
    dutyDayBefore: boolean;
    dutySameDay: boolean;
    settleDaysAfter: number;
    notifyHour: number; // 通知する時刻(時)
    notifyMinute: number;
  };
  lineTemplate: string;
  autoLockMinutes: number;
  apiToken: string; // サーバー関数用アクセストークン
  closedThrough?: string; // YYYY-MM-DD 年度締め済みの日付
}

export interface Member {
  id: ID;
  name: string; // 子どもの氏名
  kana?: string;
  grade?: string;
  guardian: string; // 保護者名（例: 三浦母）
  monthlyFee: number;
  active: boolean;
  note?: string;
}

export interface FeeCharge {
  id: ID;
  memberId: ID;
  month: string; // YYYY-MM
  amount: number;
  dueDate: string;
  txId?: ID;
  waived?: boolean;
}

export type PersonKind = 'child' | 'adult' | 'sibling';

export interface Rider {
  id: ID;
  name: string;
  kind: PersonKind;
  relation?: string; // 父・母・兄 など
  memberId?: ID;
  isDriver?: boolean;
  collect: boolean; // 集金対象（選択）
  amount?: number; // 個別金額（未指定なら遠征の一人あたり金額）
  txId?: ID; // 入金確認（実際の受け取り）
}

export interface Car {
  id: ID;
  name: string; // 三浦車
  driver: string;
  riders: Rider[]; // 運転手も isDriver=true で含む
}

export type ExpenseType = 'gas' | 'toll' | 'parking' | 'other';

export interface GasCalcSnapshot {
  method: GasMethod;
  distanceKm: number; // 片道 or 入力距離
  roundTrip: boolean;
  totalKm: number;
  yenPerKm?: number;
  kmPerL?: number;
  yenPerL?: number;
  result: number;
  routeSummary?: string;
  at: string;
}

export interface Expense {
  id: ID;
  type: ExpenseType;
  carId?: ID;
  payee: string; // 精算相手（運転手など）
  label: string;
  estimate?: number; // 見積額（Google Maps 等）
  amount?: number; // 確定額
  confirmed: boolean;
  calc?: GasCalcSnapshot; // 確定時点の計算条件（設定変更後も保持）
  txId?: ID;
}

export interface ExpeditionRule {
  collectTransport: boolean; // 交通費を事前集金する
  reimburseGas: boolean;
  reimburseToll: boolean;
  reimburseParking: boolean;
  reimburseOther: boolean;
  note?: string;
}

export interface Expedition {
  id: ID;
  title: string;
  date: string;
  destination: string;
  origin?: string;
  waypoints?: string[];
  collectDue: string; // 集金期限（原則活動前）
  perPerson: number;
  rule: ExpeditionRule;
  cars: Car[];
  expenses: Expense[];
  sourceText?: string;
  createdAt: string;
}

export interface DutyAssignee {
  id: ID;
  name: string;
  amount: number;
  status: 'active' | 'cancelled' | 'replaced';
  txId?: ID;
  note?: string;
}

export interface Duty {
  id: ID;
  date: string;
  activity: string;
  assignees: DutyAssignee[];
  cancelled: boolean;
  history: { at: string; text: string }[];
}

export type TxCategory = 'fee' | 'transport' | 'gas' | 'toll' | 'parking' | 'duty' | 'refund' | 'opening' | 'other';

export interface TxRelated {
  kind: 'fee' | 'expedition' | 'duty';
  id: ID;
  subId?: ID;
}

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
  amount: number; // 正の整数
  direction: 'in' | 'out';
  category: TxCategory;
  description: string;
  related?: TxRelated;
  sourceKey?: string; // 二重計上防止キー
  recorder: string;
  createdAt: string;
  voided?: { at: string; by: string; reason: string };
  revisions: TxRevision[];
}

export interface ReminderState {
  dismissed: Record<string, string>; // key -> 日付
  notified: Record<string, string>; // key -> 通知日
}

export interface AppData {
  version: 1;
  settings: Settings;
  members: Member[];
  fees: FeeCharge[];
  expeditions: Expedition[];
  duties: Duty[];
  txs: Tx[];
  reminderState: ReminderState;
}
