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

const KEY = 'courses_app_v1';

type Ride = { id: string; ts: number; amount: number };
type Operation = { id: string; ts: number; description: string; amount: number; type: 'add' | 'deduct' };
type Tab = 'today' | 'history';

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
const fmtMoney = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ar';

const totalOperations = (ops: Operation[], type: 'add' | 'deduct'): number =>
  ops.filter((o) => o.type === type).reduce((acc, o) => acc + o.amount, 0);

const newId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const TODAY_KEY = dayKey(Date.now());

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

export default function App(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const cardBasis = width >= 700 ? '30%' : '45%';

  const [rides, setRides] = useState<Ride[]>([]);
  const [price, setPrice] = useState<string>('5000');
  const [tab, setTab] = useState<Tab>('today');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [opType, setOpType] = useState<'add' | 'deduct'>('add');
  const [opDesc, setOpDesc] = useState<string>('');
  const [opAmount, setOpAmount] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const data = JSON.parse(raw);
          setRides(data.rides || []);
          if (data.price) setPrice(String(data.price));
          setOperations(data.operations || []);
        }
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(KEY, JSON.stringify({ rides, price, operations })).catch(() => {});
  }, [rides, price, operations, loaded]);

  const todayKey = TODAY_KEY;

  const today = useMemo(() => {
    const todaysRides = rides.filter((r) => dayKey(r.ts) === todayKey);
    return {
      count: todaysRides.length,
      total: todaysRides.reduce((acc, r) => acc + r.amount, 0),
    };
  }, [rides, todayKey]);

  const todayRides = useMemo(
    () => rides.filter((r) => dayKey(r.ts) === todayKey).sort((a, b) => b.ts - a.ts),
    [rides, todayKey]
  );

  const todayOps = useMemo(
    () => operations.filter((o) => dayKey(o.ts) === todayKey).sort((a, b) => b.ts - a.ts),
    [operations, todayKey]
  );

  const todayAdditions = totalOperations(todayOps, 'add');
  const todayDeductions = totalOperations(todayOps, 'deduct');
  const todayAPayer = today.total + todayAdditions - todayDeductions;

  const addRide = (): void => {
    const amount = parseInt(price, 10) || 0;
    if (amount <= 0) {
      Alert.alert('Vidy diso', 'Ampidiro ny vidin\u2019ny course.');
      return;
    }
    setRides((prev) => [...prev, { id: newId(), ts: Date.now(), amount }]);
  };

  const removeRide = (id: string): void => {
    Alert.alert('Hamafa ity course ity?', '', [
      { text: 'Tsia', style: 'cancel' },
      { text: 'Fafana', style: 'destructive', onPress: () => setRides((p) => p.filter((r) => r.id !== id)) },
    ]);
  };

  const addOperation = (): void => {
    const amount = parseInt(opAmount, 10) || 0;
    if (amount <= 0) {
      Alert.alert('Vola diso', 'Ampidiro ny vola ho an\u2019ity operation ity.');
      return;
    }
    const description = opDesc.trim() || (opType === 'add' ? 'Addition' : 'Deduction');
    setOperations((prev) => [
      ...prev,
      { id: newId(), ts: Date.now(), description, amount, type: opType },
    ]);
    setOpDesc('');
    setOpAmount('');
  };

  const removeOperation = (id: string): void => {
    Alert.alert('Hamafa ity operation ity?', '', [
      { text: 'Tsia', style: 'cancel' },
      {
        text: 'Fafana',
        style: 'destructive',
        onPress: () => setOperations((p) => p.filter((o) => o.id !== id)),
      },
    ]);
  };

  const grandDays = useMemo(() => {
    const map: Record<string, { key: string; count: number; total: number; additions: number; deductions: number }> = {};
    rides.forEach((r) => {
      const k = dayKey(r.ts);
      if (!map[k]) map[k] = { key: k, count: 0, total: 0, additions: 0, deductions: 0 };
      map[k].count += 1;
      map[k].total += r.amount;
    });
    operations.forEach((o) => {
      const k = dayKey(o.ts);
      if (!map[k]) map[k] = { key: k, count: 0, total: 0, additions: 0, deductions: 0 };
      if (o.type === 'add') map[k].additions += o.amount;
      else map[k].deductions += o.amount;
    });
    return Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [rides, operations]);

  const grand = useMemo(
    () =>
      grandDays.reduce(
        (acc, d) => ({
          key: acc.key,
          count: acc.count + d.count,
          total: acc.total + d.total,
          additions: acc.additions + d.additions,
          deductions: acc.deductions + d.deductions,
        }),
        { key: '', count: 0, total: 0, additions: 0, deductions: 0 }
      ),
    [grandDays]
  );

  const overallAPayer = grand.total + grand.additions - grand.deductions;

  const netColor = (n: number): string => (n < 0 ? '#EF4444' : '#111827');

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <Text style={s.title}>Courses</Text>
        <View style={s.tabs}>
          {([['today', 'Anio'], ['history', 'Tantara']] as [Tab, string][]).map(([k, label]) => (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}>
              <Text style={[s.tabTxt, tab === k && s.tabTxtOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'today' ? (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.date}>{fmtDay(todayKey)}</Text>

          <View style={s.cards}>
            <StatCard label="Isan'ny course" value={String(today.count)} basis={cardBasis} />
            <StatCard label="Totaly" value={fmtMoney(today.total)} basis={cardBasis} />
            <StatCard
              label="Total additions"
              value={fmtMoney(todayAdditions)}
              color="#10B981"
              basis={cardBasis}
            />
            <StatCard
              label="Total deductions"
              value={fmtMoney(todayDeductions)}
              color="#EF4444"
              basis={cardBasis}
            />
            <StatCard
              label="Total \u00e0 payer"
              value={fmtMoney(todayAPayer)}
              color={netColor(todayAPayer)}
              basis={cardBasis}
              wide
            />
          </View>

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
                  style={[
                    s.opTypeBtn,
                    opType === 'add' && s.opTypeAddOn,
                  ]}
                  onPress={() => setOpType('add')}
                >
                  <Text style={s.opTypeTxt}>+</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    s.opTypeBtn,
                    opType === 'deduct' && s.opTypeDeductOn,
                  ]}
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

          <Text style={s.sectionTitle}>Course anio</Text>
          {todayRides.length === 0 ? (
            <Text style={s.empty}>Mbola tsy misy course anio.</Text>
          ) : (
            todayRides.map((item) => (
              <View key={item.id} style={s.row}>
                <Text style={s.rowMain}>
                  Course · {fmtTime(item.ts)}
                </Text>
                <Text style={s.rowAmount}>{fmtMoney(item.amount)}</Text>
                <TouchableOpacity onPress={() => removeRide(item.id)} hitSlop={8}>
                  <Text style={s.del}>&times;</Text>
                </TouchableOpacity>
              </View>
            ))
          )}

          <Text style={s.sectionTitle}>Operations anio</Text>
          {todayOps.length === 0 ? (
            <Text style={s.empty}>Mbola tsy misy operation anio.</Text>
          ) : (
            todayOps.map((item) => (
              <View key={item.id} style={s.row}>
                <View style={s.rowText}>
                  <Text style={s.rowMain} numberOfLines={2}>
                    {item.description}
                  </Text>
                  <Text style={s.rowSub}>{fmtTime(item.ts)}</Text>
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
        </ScrollView>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.cards}>
            <StatCard label="Course rehetra" value={String(grand.count)} basis={cardBasis} />
            <StatCard label="Totaly rehetra" value={fmtMoney(grand.total)} basis={cardBasis} />
            <StatCard
              label="Total additions"
              value={fmtMoney(grand.additions)}
              color="#10B981"
              basis={cardBasis}
            />
            <StatCard
              label="Total deductions"
              value={fmtMoney(grand.deductions)}
              color="#EF4444"
              basis={cardBasis}
            />
            <StatCard
              label="Total \u00e0 payer"
              value={fmtMoney(overallAPayer)}
              color={netColor(overallAPayer)}
              basis={cardBasis}
              wide
            />
          </View>

          <Text style={s.sectionTitle}>Tantara isan&apos;andro</Text>
          {grandDays.length === 0 ? (
            <Text style={s.empty}>Tsy misy tantara.</Text>
          ) : (
            grandDays.map((item) => {
              const net = item.total + item.additions - item.deductions;
              return (
                <View key={item.key} style={s.dayCard}>
                  <View style={s.dayTop}>
                    <Text style={s.dayDate}>{fmtDay(item.key)}</Text>
                    <Text style={[s.dayNet, { color: netColor(net) }]}>{fmtMoney(net)}</Text>
                  </View>
                  <View style={s.dayStats}>
                    <View style={s.dayStat}>
                      <Text style={s.dayStatLabel}>Course</Text>
                      <Text style={s.dayStatValue}>{item.count}</Text>
                    </View>
                    <View style={s.dayStat}>
                      <Text style={s.dayStatLabel}>Totaly</Text>
                      <Text style={s.dayStatValue}>{fmtMoney(item.total)}</Text>
                    </View>
                    <View style={s.dayStat}>
                      <Text style={s.dayStatLabel}>Additions</Text>
                      <Text style={[s.dayStatValue, { color: '#10B981' }]}>
                        +{fmtMoney(item.additions)}
                      </Text>
                    </View>
                    <View style={s.dayStat}>
                      <Text style={s.dayStatLabel}>Deductions</Text>
                      <Text style={[s.dayStatValue, { color: '#EF4444' }]}>
                        &minus;{fmtMoney(item.deductions)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
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
  date: { fontSize: 16, color: '#374151', marginBottom: 8 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  card: { flexGrow: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14 },
  cardLabel: { color: '#6B7280', fontSize: 13 },
  cardValue: { fontSize: 20, fontWeight: '800', color: '#111827', marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  priceLabel: { color: '#374151' },
  input: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 90, fontSize: 16 },
  bigBtn: { backgroundColor: '#16A34A', borderRadius: 16, paddingVertical: 22, alignItems: 'center' },
  bigBtnTxt: { color: '#fff', fontSize: 28, fontWeight: '800' },
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
  dayStats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  dayStat: { width: '50%', paddingRight: 8 },
  dayStatLabel: { color: '#6B7280', fontSize: 12 },
  dayStatValue: { color: '#111827', fontSize: 15, fontWeight: '700', marginTop: 2 },
});
