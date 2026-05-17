export type AxisSide  = 'left' | 'right'
export type ChartType = 'line' | 'area' | 'bar'

export interface SeriesConfig {
  id: string
  label: string
  type: 'stocks' | 'fred' | 'formula'
  ticker?: string   // stooq format for stocks/indices
  fredId?: string
  formula?: string
  color: string
  axis: AxisSide
  chartType: ChartType
  normalize: boolean
  visible: boolean
  data: DataPoint[]
  loading: boolean
  error?: string
}

export interface DataPoint {
  date: string
  value: number | null
}

export type DateRange = '1Y' | '2Y' | '5Y'

export type PresetItem = Omit<SeriesConfig, 'data' | 'loading' | 'normalize' | 'chartType' | 'visible'>

export interface PresetGroup {
  label: string
  items: PresetItem[]
}

export const PRESET_GROUPS: PresetGroup[] = [
  {
    label: '股市指數',
    items: [
      { id: 'SP500',  label: 'S&P 500',    type: 'stocks', ticker: '^spx', color: '#4ade80', axis: 'left' },
      { id: 'NASDAQ', label: 'Nasdaq 100', type: 'stocks', ticker: '^ndq', color: '#60a5fa', axis: 'left' },
      { id: 'DOW',    label: 'Dow Jones',  type: 'stocks', ticker: '^dji', color: '#f59e0b', axis: 'left' },
      { id: 'SOX',    label: '費城半導體 (SOXX)', type: 'stocks', ticker: 'soxx', color: '#a78bfa', axis: 'left' },
    ],
  },
  {
    label: '公債殖利率',
    items: [
      { id: 'US2Y',  label: '美國 2Y 殖利率',  type: 'fred', fredId: 'DGS2',  color: '#f87171', axis: 'right' },
      { id: 'US5Y',  label: '美國 5Y 殖利率',  type: 'fred', fredId: 'DGS5',  color: '#fbbf24', axis: 'right' },
      { id: 'US10Y', label: '美國 10Y 殖利率', type: 'fred', fredId: 'DGS10', color: '#fb923c', axis: 'right' },
      { id: 'US20Y', label: '美國 20Y 殖利率', type: 'fred', fredId: 'DGS20', color: '#c084fc', axis: 'right' },
      { id: 'US30Y', label: '美國 30Y 殖利率', type: 'fred', fredId: 'DGS30', color: '#e879f9', axis: 'right' },
      { id: 'T10Y2Y', label: '10Y-2Y 利差',   type: 'fred', fredId: 'T10Y2Y', color: '#818cf8', axis: 'right' },
      { id: 'T10Y3M', label: '10Y-3M 利差',   type: 'fred', fredId: 'T10Y3M', color: '#6ee7b7', axis: 'right' },
    ],
  },
  {
    label: '通膨',
    items: [
      { id: 'CPI',      label: 'CPI 全項',          type: 'fred', fredId: 'CPIAUCSL', color: '#f472b6', axis: 'right' },
      { id: 'CORECPI',  label: '核心 CPI',           type: 'fred', fredId: 'CPILFESL', color: '#fb7185', axis: 'right' },
      { id: 'PCE',      label: 'PCE 物價',           type: 'fred', fredId: 'PCEPI',    color: '#e879f9', axis: 'right' },
      { id: 'COREPCE',  label: '核心 PCE',           type: 'fred', fredId: 'PCEPILFE', color: '#d946ef', axis: 'right' },
    ],
  },
  {
    label: '就業',
    items: [
      { id: 'UNRATE', label: '失業率',       type: 'fred', fredId: 'UNRATE', color: '#f87171', axis: 'right' },
      { id: 'PAYEMS', label: '非農就業人數', type: 'fred', fredId: 'PAYEMS', color: '#fca5a5', axis: 'right' },
      { id: 'ICSA',   label: '初領失業金',  type: 'fred', fredId: 'ICSA',   color: '#fcd34d', axis: 'right' },
    ],
  },
  {
    label: '利率 / 貨幣',
    items: [
      { id: 'FEDFUNDS',   label: '聯邦基金利率',   type: 'fred', fredId: 'FEDFUNDS',   color: '#34d399', axis: 'right' },
      { id: 'DFF',        label: '有效聯邦基金利率',type: 'fred', fredId: 'DFF',        color: '#6ee7b7', axis: 'right' },
      { id: 'MORTGAGE30', label: '30Y 房貸利率',   type: 'fred', fredId: 'MORTGAGE30US',color: '#a7f3d0', axis: 'right' },
      { id: 'M2',         label: 'M2 貨幣供給',    type: 'fred', fredId: 'M2SL',       color: '#38bdf8', axis: 'right' },
    ],
  },
  {
    label: '經濟 / 信用',
    items: [
      { id: 'GDPC1',   label: '實質 GDP',       type: 'fred', fredId: 'GDPC1',       color: '#a78bfa', axis: 'right' },
      { id: 'INDPRO',  label: '工業生產指數',    type: 'fred', fredId: 'INDPRO',      color: '#c4b5fd', axis: 'right' },
      { id: 'RSXFS',   label: '零售銷售',        type: 'fred', fredId: 'RSXFS',       color: '#ddd6fe', axis: 'right' },
      { id: 'HYSPR',   label: '高收益債利差',    type: 'fred', fredId: 'BAMLH0A0HYM2',color: '#fbbf24', axis: 'right' },
      { id: 'USDIDX',  label: '貿易加權美元',    type: 'fred', fredId: 'DTWEXBGS',   color: '#60a5fa', axis: 'right' },
      { id: 'OIL',     label: 'WTI 原油',        type: 'fred', fredId: 'DCOILWTICO', color: '#f59e0b', axis: 'right' },
      { id: 'UMCSENT', label: '消費者信心',      type: 'fred', fredId: 'UMCSENT',    color: '#2dd4bf', axis: 'right' },
    ],
  },
]

// Flat list for backward compatibility
export const PRESET_SERIES: PresetItem[] = PRESET_GROUPS.flatMap((g) => g.items)

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '1Y': '1年', '2Y': '2年', '5Y': '5年',
}

export const COLORS = [
  '#4ade80','#60a5fa','#f59e0b','#f87171','#fb923c','#e879f9',
  '#34d399','#a78bfa','#38bdf8','#fbbf24','#f472b6','#2dd4bf',
]

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: '折線', area: '面積', bar: '長棒',
}
