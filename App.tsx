import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  SafeAreaView,
  StatusBar,
  Platform,
  ScrollView,
  useWindowDimensions,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SMS from 'expo-sms';

const KEY = 'courses_app_v1';

type Ride = { id: string; ts: number; amount: number };
type Operation = { id: string; ts: number; description: string; amount: number; type: 'add' | 'deduct' };
type Tab = 'current' | 'history';
type CycleStatus = 'active' | 'paid';

type CycleTotals = {
  count: number;
  courseTotal: number;
  additions: number;
  deductions: number;
  totalAPayer: number;
};

type PaymentCycle = {
  id: string;
  status: CycleStatus;
  startedAt: number;
  closedAt: number | null;
  rides: Ride[];
  operations: Operation[];
  totals: CycleTotals;
};

type StoredData = {
  price?: string | number;
  cycles?: PaymentCycle[];
  rides?: Ride[];
  operations?: Operation[];
};

const dayKey = (ts: number): string => {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${j}`;
};
const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (key: string): string => {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};
const fmtDateTime = (ts: number): string => `${fmtDay(dayKey(ts))} at ${fmtTime(ts)}`;
const fmtMoney = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ar';

const totalOperations = (ops: Operation[], type: 'add' | 'deduct'): number =>
  ops.filter((o) => o.type === type).reduce((acc, o) => acc + o.amount, 0);

const computeTotals = (rides: Ride[], operations: Operation[]): CycleTotals => {
  const courseTotal = rides.reduce((acc, r) => acc + r.amount, 0);
  const additions = totalOperations(operations, 'add');
  const deductions = totalOperations(operations, 'deduct');
  return {
    count: rides.length,
    courseTotal,
    additions,
    deductions,
    totalAPayer: courseTotal + additions - deductions,
  };
};

const newId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createCycle = (overrides?: Partial<PaymentCycle>): PaymentCycle => {
  const rides = overrides?.rides ?? [];
  const operations = overrides?.operations ?? [];
  return {
    id: newId(),
    status: 'active',
    startedAt: Date.now(),
    closedAt: null,
    rides,
    operations,
    totals: computeTotals(rides, operations),
    ...overrides,
  };
};

const normalizeCycle = (raw: Partial<PaymentCycle>): PaymentCycle => {
  const rides = Array.isArray(raw.rides) ? raw.rides : [];
  const operations = Array.isArray(raw.operations) ? raw.operations : [];
  const status: CycleStatus = raw.status === 'paid' ? 'paid' : 'active';
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    status,
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : Date.now(),
    closedAt: typeof raw.closedAt === 'number' ? raw.closedAt : null,
    rides,
    operations,
    totals: computeTotals(rides, operations),
  };
};

const normalizeStoredData = (data: StoredData): PaymentCycle[] => {
  const storedCycles = Array.isArray(data.cycles) ? data.cycles : [];
  let cycles = storedCycles.map(normalizeCycle);

  if (cycles.length === 0) {
    const legacyRides = Array.isArray(data.rides) ? data.rides : [];
    const legacyOperations = Array.isArray(data.operations) ? data.operations : [];
    const timestamps = [...legacyRides, ...legacyOperations].map((item) => item.ts);
    const startedAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
    cycles = [
      createCycle({
        startedAt,
        rides: legacyRides,
        operations: legacyOperations,
      }),
    ];
  }

  if (!cycles.some((cycle) => cycle.status === 'active')) {
    cycles.push(createCycle());
  }

  return cycles;
};

const buildShareMessage = (rides: Ride[], operations: Operation[], total: number): string => {
  const lines: string[] = [
    'Hello, here is the summary of completed rides:',
    '',
  ];

  [...rides]
    .sort((a, b) => a.ts - b.ts)
    .forEach((ride) => {
      lines.push(
        `- Ride on ${fmtDay(dayKey(ride.ts))} at ${fmtTime(ride.ts)}: ${fmtMoney(ride.amount)}`
      );
    });

  [...operations]
    .sort((a, b) => a.ts - b.ts)
    .forEach((operation) => {
      const sign = operation.type === 'add' ? '+' : '-';
      lines.push(`- ${operation.description}: ${sign}${fmtMoney(operation.amount)}`);
    });

  lines.push('', `Total to pay: ${fmtMoney(total)}`, '', 'Thank you.');
  return lines.join('\n');
};

type StatCardProps = {
  label: string;
  value: string;
  color?: string;
  basis: string;
  wide?: boolean;
};

function StatCard({ label, value, color, basis, wide }: StatCardProps): React.JSX.Element {
  return (
    <View style={[s.card, { flexBasis: wide ? '100%' : basis }]}>
      <Text style={s.cardLabel}>{label}</Text>
      <Text style={[s.cardValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: CycleStatus }): React.JSX.Element {
  const paid = status === 'paid';
  return (
    <View style={[s.badge, paid ? s.badgePaid : s.badgeActive]}>
      <Text style={[s.badgeTxt, paid ? s.badgeTxtPaid : s.badgeTxtActive]}>
        {paid ? 'Paid' : 'Active'}
      </Text>
    </View>
  );
}

function SmsIcon(): React.JSX.Element {
  return (
    <View style={s.smsIcon}>
      <View style={s.smsBubble}>
        <View style={s.smsDot} />
        <View style={s.smsDot} />
        <View style={s.smsDot} />
      </View>
      <View style={s.smsTail} />
    </View>
  );
}

function WhatsAppIcon(): React.JSX.Element {
  return (
    <View style={s.waIcon}>
      <View style={s.waBubble}>
        <View style={s.waPhone} />
      </View>
      <View style={s.waTail} />
    </View>
  );
}

type CycleHistoryCardProps = {
  cycle: PaymentCycle;
  expanded: boolean;
  onToggle: () => void;
  onShareSms: () => void;
  onShareWhatsApp: () => void;
};

function CycleHistoryCard({
  cycle,
  expanded,
  onToggle,
  onShareSms,
  onShareWhatsApp,
}: CycleHistoryCardProps): React.JSX.Element {
  const totals = cycle.totals ?? computeTotals(cycle.rides, cycle.operations);
  const sortedRides = [...cycle.rides].sort((a, b) => b.ts - a.ts);
  const sortedOperations = [...cycle.operations].sort((a, b) => b.ts - a.ts);

  return (
    <View style={s.dayCard}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.85}>
        <View style={s.dayTop}>
          <View style={s.cycleTitleWrap}>
            <Text style={s.dayDate}>Cycle of {fmtDay(dayKey(cycle.startedAt))}</Text>
            <Text style={s.cycleSub}>
              Closed on {fmtDateTime(cycle.closedAt ?? cycle.startedAt)}
            </Text>
          </View>
          <StatusBadge status="paid" />
        </View>
        <View style={s.cycleTotalRow}>
          <Text style={s.cycleTotalLabel}>Total to pay</Text>
          <Text style={[s.cycleTotal, { color: cycle.totals.totalAPayer < 0 ? '#EF4444' : '#111827' }]}>
            {fmtMoney(totals.totalAPayer)}
          </Text>
        </View>
        <Text style={s.cycleHint}>{expanded ? 'Hide details' : 'View details'}</Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={s.cycleDetails}>
          <View style={s.dayStats}>
            <View style={s.dayStat}>
              <Text style={s.dayStatLabel}>Rides</Text>
              <Text style={s.dayStatValue}>{totals.count}</Text>
            </View>
            <View style={s.dayStat}>
              <Text style={s.dayStatLabel}>Total</Text>
              <Text style={s.dayStatValue}>{fmtMoney(totals.courseTotal)}</Text>
            </View>
            <View style={s.dayStat}>
              <Text style={s.dayStatLabel}>Additions</Text>
              <Text style={[s.dayStatValue, { color: '#10B981' }]}>
                +{fmtMoney(totals.additions)}
              </Text>
            </View>
            <View style={s.dayStat}>
              <Text style={s.dayStatLabel}>Deductions</Text>
              <Text style={[s.dayStatValue, { color: '#EF4444' }]}>
                &minus;{fmtMoney(totals.deductions)}
              </Text>
            </View>
          </View>

          <Text style={s.sectionTitle}>Rides ({sortedRides.length})</Text>
          {sortedRides.length === 0 ? (
            <Text style={s.empty}>No rides.</Text>
          ) : (
            sortedRides.map((item) => (
              <View key={item.id} style={s.row}>
                <Text style={s.rowMain}>
                  Ride · {fmtDay(dayKey(item.ts))} · {fmtTime(item.ts)}
                </Text>
                <Text style={s.rowAmount}>{fmtMoney(item.amount)}</Text>
              </View>
            ))
          )}

          <Text style={s.sectionTitle}>Operations ({sortedOperations.length})</Text>
          {sortedOperations.length === 0 ? (
            <Text style={s.empty}>No operations.</Text>
          ) : (
            sortedOperations.map((item) => (
              <View key={item.id} style={s.row}>
                <View style={s.rowText}>
                  <Text style={s.rowMain} numberOfLines={2}>
                    {item.description}
                  </Text>
                  <Text style={s.rowSub}>
                    {fmtDay(dayKey(item.ts))} · {fmtTime(item.ts)}
                  </Text>
                </View>
                <Text
                  style={[
                    s.rowAmount,
                    { color: item.type === 'add' ? '#10B981' : '#EF4444' },
                  ]}
                >
                  {item.type === 'add'
                    ? `+${fmtMoney(item.amount)}`
                    : `-${fmtMoney(item.amount)}`}
                </Text>
              </View>
            ))
          )}

          {cycle.rides.length > 0 || cycle.operations.length > 0 ? (
            <View style={s.shareRow}>
              <TouchableOpacity style={[s.shareBtn, s.smsBtn]} onPress={onShareSms} activeOpacity={0.8}>
                <SmsIcon />
                <Text style={s.shareBtnTxt}>SMS</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.shareBtn, s.whatsappBtn]}
                onPress={onShareWhatsApp}
                activeOpacity={0.8}
              >
                <WhatsAppIcon />
                <Text style={s.shareBtnTxt}>WhatsApp</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function App(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const cardBasis = width >= 700 ? '30%' : '45%';

  const [cycles, setCycles] = useState<PaymentCycle[]>(() => [createCycle()]);
  const [price, setPrice] = useState<string>('5000');
  const [tab, setTab] = useState<Tab>('current');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [opType, setOpType] = useState<'add' | 'deduct'>('add');
  const [opDesc, setOpDesc] = useState<string>('');
  const [opAmount, setOpAmount] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const data = JSON.parse(raw) as StoredData;
          setCycles(normalizeStoredData(data));
          if (data.price) setPrice(String(data.price));
        }
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(KEY, JSON.stringify({ price, cycles })).catch(() => {});
  }, [cycles, price, loaded]);

  const activeCycle = useMemo(
    () => cycles.find((cycle) => cycle.status === 'active') ?? null,
    [cycles]
  );

  const activeRides = useMemo(() => activeCycle?.rides ?? [], [activeCycle]);
  const activeOperations = useMemo(() => activeCycle?.operations ?? [], [activeCycle]);

  const activeTotals = useMemo(
    () => computeTotals(activeRides, activeOperations),
    [activeRides, activeOperations]
  );

  const sortedActiveRides = useMemo(
    () => [...activeRides].sort((a, b) => b.ts - a.ts),
    [activeRides]
  );

  const sortedActiveOperations = useMemo(
    () => [...activeOperations].sort((a, b) => b.ts - a.ts),
    [activeOperations]
  );

  const closedCycles = useMemo(
    () =>
      cycles
        .filter((cycle) => cycle.status === 'paid')
        .sort((a, b) => (b.closedAt ?? b.startedAt) - (a.closedAt ?? a.startedAt)),
    [cycles]
  );

  const addRide = (): void => {
    const amount = parseInt(price, 10) || 0;
    if (amount <= 0) {
      Alert.alert('Invalid price', 'Enter the ride price.');
      return;
    }
    const ride: Ride = { id: newId(), ts: Date.now(), amount };
    setCycles((prev) => {
      const active = prev.find((cycle) => cycle.status === 'active');
      if (!active) return [...prev, createCycle({ rides: [ride] })];
      return prev.map((cycle) =>
        cycle.id === active.id ? { ...cycle, rides: [...cycle.rides, ride] } : cycle
      );
    });
  };

  const removeRide = (id: string): void => {
    Alert.alert('Delete this ride?', '', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          setCycles((prev) =>
            prev.map((cycle) =>
              cycle.status === 'active'
                ? { ...cycle, rides: cycle.rides.filter((ride) => ride.id !== id) }
                : cycle
            )
          ),
      },
    ]);
  };

  const addOperation = (): void => {
    const amount = parseInt(opAmount, 10) || 0;
    if (amount <= 0) {
      Alert.alert('Invalid amount', 'Enter the amount for this operation.');
      return;
    }
    const description = opDesc.trim() || (opType === 'add' ? 'Addition' : 'Deduction');
    const operation: Operation = {
      id: newId(),
      ts: Date.now(),
      description,
      amount,
      type: opType,
    };
    setCycles((prev) => {
      const active = prev.find((cycle) => cycle.status === 'active');
      if (!active) return [...prev, createCycle({ operations: [operation] })];
      return prev.map((cycle) =>
        cycle.id === active.id
          ? { ...cycle, operations: [...cycle.operations, operation] }
          : cycle
      );
    });
    setOpDesc('');
    setOpAmount('');
  };

  const removeOperation = (id: string): void => {
    Alert.alert('Delete this operation?', '', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          setCycles((prev) =>
            prev.map((cycle) =>
              cycle.status === 'active'
                ? {
                    ...cycle,
                    operations: cycle.operations.filter((operation) => operation.id !== id),
                  }
                : cycle
            )
          ),
      },
    ]);
  };

  const closeActiveCycle = (): void => {
    if (!activeCycle) return;
    if (activeRides.length === 0 && activeOperations.length === 0) {
      Alert.alert(
        'Empty cycle',
        'There are no rides or operations in the current cycle.'
      );
      return;
    }

    const totals = computeTotals(activeRides, activeOperations);
    Alert.alert(
      'Mark as paid?',
      `Total to pay: ${fmtMoney(totals.totalAPayer)}\n\nThe cycle will be closed and archived. A new cycle at 0 Ar will be created.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            const closedAt = Date.now();
            setCycles((prev) => {
              const updated = prev.map((cycle) =>
                cycle.id === activeCycle.id
                  ? {
                      ...cycle,
                      status: 'paid' as const,
                      closedAt,
                      totals: computeTotals(cycle.rides, cycle.operations),
                    }
                  : cycle
              );
              return [...updated, createCycle({ startedAt: closedAt })];
            });
            setExpandedCycleId(null);
            setTab('current');
            Alert.alert(
              'Cycle closed',
              'The cycle has been archived. A new cycle has started at 0 Ar.'
            );
          },
        },
      ]
    );
  };

  const shareCycleBySms = async (cycle: PaymentCycle): Promise<void> => {
    if (cycle.rides.length === 0 && cycle.operations.length === 0) return;
    const totals = computeTotals(cycle.rides, cycle.operations);
    try {
      const available = await SMS.isAvailableAsync();
      if (!available) {
        Alert.alert(
          'SMS unavailable',
          'No SMS application is available on this device.'
        );
        return;
      }
      await SMS.sendSMSAsync([], buildShareMessage(cycle.rides, cycle.operations, totals.totalAPayer));
    } catch {
      Alert.alert('Error', 'Unable to open the SMS application.');
    }
  };

  const shareCycleByWhatsApp = async (cycle: PaymentCycle): Promise<void> => {
    if (cycle.rides.length === 0 && cycle.operations.length === 0) return;
    const totals = computeTotals(cycle.rides, cycle.operations);
    const text = encodeURIComponent(
      buildShareMessage(cycle.rides, cycle.operations, totals.totalAPayer)
    );
    try {
      const nativeUrl = `whatsapp://send?text=${text}`;
      if (await Linking.canOpenURL(nativeUrl)) {
        await Linking.openURL(nativeUrl);
        return;
      }
      const webUrl = `https://wa.me/?text=${text}`;
      if (await Linking.canOpenURL(webUrl)) {
        await Linking.openURL(webUrl);
        return;
      }
      Alert.alert('WhatsApp unavailable', 'WhatsApp is not installed on this device.');
    } catch {
      Alert.alert('Error', 'Unable to open WhatsApp.');
    }
  };

  const netColor = (n: number): string => (n < 0 ? '#EF4444' : '#111827');

  const activeIsEmpty = activeRides.length === 0 && activeOperations.length === 0;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <Text style={s.title}>Courses</Text>
        <View style={s.tabs}>
          {([['current', 'Cycle'], ['history', 'History']] as [Tab, string][]).map(([k, label]) => (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}>
              <Text style={[s.tabTxt, tab === k && s.tabTxtOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'current' ? (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.cycleHeader}>
            <View style={s.cycleHeaderText}>
              <Text style={s.date}>
                Cycle of {activeCycle ? fmtDay(dayKey(activeCycle.startedAt)) : '--/--/----'}
              </Text>
              <Text style={s.cycleSub}>Current cycle status</Text>
            </View>
            <StatusBadge status="active" />
          </View>

          <View style={s.cards}>
            <StatCard label="Rides" value={String(activeTotals.count)} basis={cardBasis} />
            <StatCard label="Total" value={fmtMoney(activeTotals.courseTotal)} basis={cardBasis} />
            <StatCard
              label="Total additions"
              value={fmtMoney(activeTotals.additions)}
              color="#10B981"
              basis={cardBasis}
            />
            <StatCard
              label="Total deductions"
              value={fmtMoney(activeTotals.deductions)}
              color="#EF4444"
              basis={cardBasis}
            />
            <StatCard
              label="Total to pay"
              value={fmtMoney(activeTotals.totalAPayer)}
              color={netColor(activeTotals.totalAPayer)}
              basis={cardBasis}
              wide
            />
          </View>

          <TouchableOpacity
            style={[s.closeBtn, activeIsEmpty && s.closeBtnDisabled]}
            onPress={closeActiveCycle}
            activeOpacity={0.8}
          >
            <Text style={s.closeBtnTxt}>Mark as paid</Text>
            <Text style={s.closeBtnSub}>Close and start a new cycle</Text>
          </TouchableOpacity>

          <View style={s.priceRow}>
            <Text style={s.priceLabel}>Price per ride:</Text>
            <TextInput
              style={s.input}
              value={price}
              onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#9CA3AF"
            />
            <Text style={s.priceLabel}>Ar</Text>
          </View>

          <TouchableOpacity style={s.bigBtn} onPress={addRide} activeOpacity={0.8}>
            <Text style={s.bigBtnTxt}>+ Ride</Text>
          </TouchableOpacity>

          <View style={s.opForm}>
            <Text style={s.sectionTitle}>Operation</Text>
            <TextInput
              style={s.opInput}
              value={opDesc}
              onChangeText={setOpDesc}
              placeholder="Description..."
              placeholderTextColor="#6B7280"
            />
            <View style={s.opFormRow}>
              <TextInput
                style={s.opInput}
                value={opAmount}
                onChangeText={(t) => setOpAmount(t.replace(/[^0-9]/g, ''))}
                placeholder="Amount (Ar)"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
              />
              <View style={s.opTypeRow}>
                <TouchableOpacity
                  style={[s.opTypeBtn, opType === 'add' && s.opTypeAddOn]}
                  onPress={() => setOpType('add')}
                >
                  <Text style={s.opTypeTxt}>+</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.opTypeBtn, opType === 'deduct' && s.opTypeDeductOn]}
                  onPress={() => setOpType('deduct')}
                >
                  <Text style={s.opTypeTxt}>&minus;</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity style={s.opBtn} onPress={addOperation} activeOpacity={0.8}>
              <Text style={s.opBtnTxt}>Add operation</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.sectionTitle}>Rides ({sortedActiveRides.length})</Text>
          {sortedActiveRides.length === 0 ? (
            <Text style={s.empty}>No rides in this cycle yet.</Text>
          ) : (
            sortedActiveRides.map((item) => (
              <View key={item.id} style={s.row}>
                <Text style={s.rowMain}>
                  Ride · {fmtDay(dayKey(item.ts))} · {fmtTime(item.ts)}
                </Text>
                <Text style={s.rowAmount}>{fmtMoney(item.amount)}</Text>
                <TouchableOpacity onPress={() => removeRide(item.id)} hitSlop={8}>
                  <Text style={s.del}>&times;</Text>
                </TouchableOpacity>
              </View>
            ))
          )}

          <Text style={s.sectionTitle}>Operations ({sortedActiveOperations.length})</Text>
          {sortedActiveOperations.length === 0 ? (
            <Text style={s.empty}>No operations in this cycle yet.</Text>
          ) : (
            sortedActiveOperations.map((item) => (
              <View key={item.id} style={s.row}>
                <View style={s.rowText}>
                  <Text style={s.rowMain} numberOfLines={2}>
                    {item.description}
                  </Text>
                  <Text style={s.rowSub}>
                    {fmtDay(dayKey(item.ts))} · {fmtTime(item.ts)}
                  </Text>
                </View>
                <Text
                  style={[
                    s.rowAmount,
                    { color: item.type === 'add' ? '#10B981' : '#EF4444' },
                  ]}
                >
                  {item.type === 'add' ? `+${fmtMoney(item.amount)}` : `-${fmtMoney(item.amount)}`}
                </Text>
                <TouchableOpacity onPress={() => removeOperation(item.id)} hitSlop={8}>
                  <Text style={s.del}>&times;</Text>
                </TouchableOpacity>
              </View>
            ))
          )}

          {!activeIsEmpty ? (
            <View style={s.shareRow}>
              <TouchableOpacity
                style={[s.shareBtn, s.smsBtn]}
                onPress={() => shareCycleBySms(activeCycle as PaymentCycle)}
                activeOpacity={0.8}
              >
                <SmsIcon />
                <Text style={s.shareBtnTxt}>SMS</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.shareBtn, s.whatsappBtn]}
                onPress={() => shareCycleByWhatsApp(activeCycle as PaymentCycle)}
                activeOpacity={0.8}
              >
                <WhatsAppIcon />
                <Text style={s.shareBtnTxt}>WhatsApp</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sectionTitle}>Payment history</Text>
          {closedCycles.length === 0 ? (
            <Text style={s.empty}>No completed cycles yet.</Text>
          ) : (
            closedCycles.map((cycle) => (
              <CycleHistoryCard
                key={cycle.id}
                cycle={cycle}
                expanded={expandedCycleId === cycle.id}
                onToggle={() =>
                  setExpandedCycleId((current) => (current === cycle.id ? null : cycle.id))
                }
                onShareSms={() => shareCycleBySms(cycle)}
                onShareWhatsApp={() => shareCycleByWhatsApp(cycle)}
              />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F4F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: { backgroundColor: '#111827', padding: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 10 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#1F2937' },
  tabOn: { backgroundColor: '#FBBF24' },
  tabTxt: { color: '#9CA3AF', fontWeight: '600' },
  tabTxtOn: { color: '#111827' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  date: { fontSize: 16, color: '#374151', marginBottom: 2 },
  cycleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  cycleHeaderText: { flex: 1 },
  cycleTitleWrap: { flex: 1 },
  cycleSub: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  badgeActive: { backgroundColor: '#FEF3C7' },
  badgePaid: { backgroundColor: '#DCFCE7' },
  badgeTxt: { fontSize: 12, fontWeight: '700' },
  badgeTxtActive: { color: '#92400E' },
  badgeTxtPaid: { color: '#166534' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  card: { flexGrow: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14 },
  cardLabel: { color: '#6B7280', fontSize: 13 },
  cardValue: { fontSize: 20, fontWeight: '800', color: '#111827', marginTop: 4 },
  closeBtn: { backgroundColor: '#111827', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  closeBtnDisabled: { opacity: 0.4 },
  closeBtnTxt: { color: '#fff', fontSize: 18, fontWeight: '800' },
  closeBtnSub: { color: '#9CA3AF', fontSize: 12, marginTop: 4, textAlign: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  priceLabel: { color: '#374151' },
  input: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 90, fontSize: 16 },
  bigBtn: { backgroundColor: '#16A34A', borderRadius: 16, paddingVertical: 22, alignItems: 'center' },
  bigBtnTxt: { color: '#fff', fontSize: 28, fontWeight: '800' },
  shareRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 14 },
  shareBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  smsBtn: { backgroundColor: '#111827' },
  whatsappBtn: { backgroundColor: '#25D366' },
  smsIcon: { width: 24, height: 22, alignItems: 'center', justifyContent: 'center' },
  smsBubble: { width: 22, height: 16, borderRadius: 5, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  smsDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#111827' },
  smsTail: { width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff', marginTop: -1, marginLeft: -10 },
  waIcon: { width: 24, height: 22, alignItems: 'center', justifyContent: 'center' },
  waBubble: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  waPhone: { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: '#fff' },
  waTail: { width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff', marginTop: -2, marginLeft: -8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 16, marginBottom: 8 },
  row: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowText: { flex: 1 },
  rowMain: { color: '#111827', fontSize: 15, flexShrink: 1 },
  rowSub: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  rowAmount: { color: '#111827', fontSize: 15, fontWeight: '700', flexShrink: 0 },
  del: { color: '#DC2626', fontSize: 20, paddingHorizontal: 4 },
  empty: { textAlign: 'center', color: '#9CA3AF', marginVertical: 16 },
  opForm: { marginTop: 16, padding: 12, backgroundColor: '#fff', borderRadius: 12 },
  opFormRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  opInput: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 8, padding: 10, fontSize: 15 },
  opTypeRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  opTypeBtn: { minWidth: 44, padding: 8, borderRadius: 6, borderWidth: 2, borderColor: 'transparent', alignItems: 'center' },
  opTypeAddOn: { borderColor: '#10B981', backgroundColor: '#F0FDF4' },
  opTypeDeductOn: { borderColor: '#EF4444', backgroundColor: '#FEE2E2' },
  opTypeTxt: { fontSize: 18, fontWeight: '700', color: '#111827' },
  opBtn: { backgroundColor: '#16A34A', borderRadius: 16, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  opBtnTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
  dayCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 },
  dayTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 },
  dayDate: { fontSize: 16, fontWeight: '700', color: '#111827', flexShrink: 1 },
  dayNet: { fontSize: 16, fontWeight: '800' },
  cycleTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cycleTotalLabel: { color: '#6B7280', fontSize: 13 },
  cycleTotal: { fontSize: 18, fontWeight: '800' },
  cycleHint: { color: '#2563EB', fontSize: 13, fontWeight: '600', marginTop: 8 },
  cycleDetails: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 8 },
  dayStats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  dayStat: { width: '50%', paddingRight: 8 },
  dayStatLabel: { color: '#6B7280', fontSize: 12 },
  dayStatValue: { color: '#111827', fontSize: 15, fontWeight: '700', marginTop: 2 },
});
