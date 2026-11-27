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
  new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (key: string): string => {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};
const fmtDateTime = (ts: number): string => `${fmtDay(dayKey(ts))} \u00e0 ${fmtTime(ts)}`;
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

const buildSmsMessage = (rides: Ride[], operations: Operation[], total: number): string => {
  const lines: string[] = [
    'Bonjour, voici le r\u00e9capitulatif des courses effectu\u00e9es :',
    '',
  ];

  [...rides]
    .sort((a, b) => a.ts - b.ts)
    .forEach((ride) => {
      lines.push(
        `- Course du ${fmtDay(dayKey(ride.ts))} \u00e0 ${fmtTime(ride.ts)} : ${fmtMoney(ride.amount)}`
      );
    });

  [...operations]
    .sort((a, b) => a.ts - b.ts)
    .forEach((operation) => {
      const sign = operation.type === 'add' ? '+' : '-';
      lines.push(`- ${operation.description} : ${sign}${fmtMoney(operation.amount)}`);
    });

  lines.push('', `Total \u00e0 payer : ${fmtMoney(total)}`, '', 'Merci.');
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
        {paid ? 'Pay\u00e9' : 'En cours'}
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

type CycleHistoryCardProps = {
  cycle: PaymentCycle;
  expanded: boolean;
  onToggle: () => void;
  onShare: () => void;
};

function CycleHistoryCard({
  cycle,
  expanded,
  onToggle,
  onShare,
}: CycleHistoryCardProps): React.JSX.Element {
  const totals = cycle.totals ?? computeTotals(cycle.rides, cycle.operations);
  const sortedRides = [...cycle.rides].sort((a, b) => b.ts - a.ts);
  const sortedOperations = [...cycle.operations].sort((a, b) => b.ts - a.ts);

  return (
    <View style={s.dayCard}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.85}>
        <View style={s.dayTop}>
          <View style={s.cycleTitleWrap}>
            <Text style={s.dayDate}>Cycle du {fmtDay(dayKey(cycle.startedAt))}</Text>
            <Text style={s.cycleSub}>
              Cl\u00f4tur\u00e9 le {fmtDateTime(cycle.closedAt ?? cycle.startedAt)}
            </Text>
          </View>
          <StatusBadge status="paid" />
        </View>
        <View style={s.cycleTotalRow}>
          <Text style={s.cycleTotalLabel}>Total \u00e0 payer</Text>
          <Text style={[s.cycleTotal, { color: cycle.totals.totalAPayer < 0 ? '#EF4444' : '#111827' }]}>
            {fmtMoney(totals.totalAPayer)}
          </Text>
        </View>
        <Text style={s.cycleHint}>{expanded ? 'Masquer les d\u00e9tails' : 'Voir les d\u00e9tails'}</Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={s.cycleDetails}>
          <View style={s.dayStats}>
            <View style={s.dayStat}>
              <Text style={s.dayStatLabel}>Course</Text>
              <Text style={s.dayStatValue}>{totals.count}</Text>
            </View>
            <View style={s.dayStat}>
              <Text style={s.dayStatLabel}>Totaly</Text>
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

          <Text style={s.sectionTitle}>Course ({sortedRides.length})</Text>
          {sortedRides.length === 0 ? (
            <Text style={s.empty}>Tsy misy course.</Text>
          ) : (
            sortedRides.map((item) => (
              <View key={item.id} style={s.row}>
                <Text style={s.rowMain}>
                  Course · {fmtDay(dayKey(item.ts))} · {fmtTime(item.ts)}
                </Text>
                <Text style={s.rowAmount}>{fmtMoney(item.amount)}</Text>
              </View>
            ))
          )}

          <Text style={s.sectionTitle}>Operations ({sortedOperations.length})</Text>
          {sortedOperations.length === 0 ? (
            <Text style={s.empty}>Tsy misy operation.</Text>
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
            <TouchableOpacity style={s.smsBtn} onPress={onShare} activeOpacity={0.8}>
              <SmsIcon />
              <Text style={s.smsBtnTxt}>Partager par SMS</Text>
            </TouchableOpacity>
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
      Alert.alert('Vidy diso', 'Ampidiro ny vidin\u2019ny course.');
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
    Alert.alert('Hamafa ity course ity?', '', [
      { text: 'Tsia', style: 'cancel' },
      {
        text: 'Fafana',
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
      Alert.alert('Vola diso', 'Ampidiro ny vola ho an\u2019ity operation ity.');
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
    Alert.alert('Hamafa ity operation ity?', '', [
      { text: 'Tsia', style: 'cancel' },
      {
        text: 'Fafana',
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
        'Cycle vide',
        'Tsy misy course na operation ao amin\u2019ny cycle ankehitriny.'
      );
      return;
    }

    const totals = computeTotals(activeRides, activeOperations);
    Alert.alert(
      'Marquer comme pay\u00e9 ?',
      `Total \u00e0 payer : ${fmtMoney(totals.totalAPayer)}\n\nLe cycle sera cl\u00f4tur\u00e9 et archiv\u00e9. Un nouveau cycle \u00e0 0 Ar sera cr\u00e9\u00e9.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
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
              'Cycle cl\u00f4tur\u00e9',
              'Le cycle a \u00e9t\u00e9 archiv\u00e9. Un nouveau cycle a commenc\u00e9 \u00e0 0 Ar.'
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
          'SMS indisponible',
          'Aucune application SMS n\u2019est disponible sur cet appareil.'
        );
        return;
      }
      await SMS.sendSMSAsync([], buildSmsMessage(cycle.rides, cycle.operations, totals.totalAPayer));
    } catch {
      Alert.alert('Erreur', 'Impossible d\u2019ouvrir l\u2019application SMS.');
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
          {([['current', 'Cycle'], ['history', 'Tantara']] as [Tab, string][]).map(([k, label]) => (
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
                Cycle du {activeCycle ? fmtDay(dayKey(activeCycle.startedAt)) : '--/--/----'}
              </Text>
              <Text style={s.cycleSub}>Statut du cycle actuel</Text>
            </View>
            <StatusBadge status="active" />
          </View>

          <View style={s.cards}>
            <StatCard label="Isan'ny course" value={String(activeTotals.count)} basis={cardBasis} />
            <StatCard label="Totaly" value={fmtMoney(activeTotals.courseTotal)} basis={cardBasis} />
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
              label="Total \u00e0 payer"
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
            <Text style={s.closeBtnTxt}>Marquer comme pay\u00e9</Text>
            <Text style={s.closeBtnSub}>Cl\u00f4turer et commencer un nouveau cycle</Text>
          </TouchableOpacity>

          <View style={s.priceRow}>
            <Text style={s.priceLabel}>Vidy isaky ny course:</Text>
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
            <Text style={s.bigBtnTxt}>+ Course</Text>
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
                placeholder="Vola (Ar)"
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

          <Text style={s.sectionTitle}>Course ({sortedActiveRides.length})</Text>
          {sortedActiveRides.length === 0 ? (
            <Text style={s.empty}>Mbola tsy misy course ao amin&apos;ity cycle ity.</Text>
          ) : (
            sortedActiveRides.map((item) => (
              <View key={item.id} style={s.row}>
                <Text style={s.rowMain}>
                  Course · {fmtDay(dayKey(item.ts))} · {fmtTime(item.ts)}
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
            <Text style={s.empty}>Mbola tsy misy operation ao amin&apos;ity cycle ity.</Text>
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
            <TouchableOpacity
              style={s.smsBtn}
              onPress={() => shareCycleBySms(activeCycle as PaymentCycle)}
              activeOpacity={0.8}
            >
              <SmsIcon />
              <Text style={s.smsBtnTxt}>Partager par SMS</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sectionTitle}>Historique des paiements</Text>
          {closedCycles.length === 0 ? (
            <Text style={s.empty}>Tsy mbola misy cycle vita.</Text>
          ) : (
            closedCycles.map((cycle) => (
              <CycleHistoryCard
                key={cycle.id}
                cycle={cycle}
                expanded={expandedCycleId === cycle.id}
                onToggle={() =>
                  setExpandedCycleId((current) => (current === cycle.id ? null : cycle.id))
                }
                onShare={() => shareCycleBySms(cycle)}
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
  smsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#111827', borderRadius: 16, paddingVertical: 14, marginTop: 16 },
  smsBtnTxt: { color: '#fff', fontSize: 17, fontWeight: '700' },
  smsIcon: { width: 24, height: 22, alignItems: 'center', justifyContent: 'center' },
  smsBubble: { width: 22, height: 16, borderRadius: 5, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  smsDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#111827' },
  smsTail: { width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff', marginTop: -1, marginLeft: -10 },
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
