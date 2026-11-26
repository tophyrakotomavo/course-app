import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  StyleSheet,
  Alert,
  SafeAreaView,
  StatusBar,
  Platform,
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
  ops
    .filter((o) => o.type === type)
    .reduce((acc, o) => acc + o.amount, 0);

export default function App(): React.JSX.Element {
  const [rides, setRides] = useState<Ride[]>([]);
  const [price, setPrice] = useState<string>('5000');
  const [tab, setTab] = useState<Tab>('today');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [opType, setOpType] = useState<'add' | 'deduct'>('add');
  const [opDesc, setOpDesc] = useState<string>('');

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
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(KEY, JSON.stringify({ rides, price, operations })).catch(() => {});
  }, [rides, price, operations, loaded]);

  const todayKey = useMemo(() => {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const j = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${j}`;
  }, []);

  const days = useMemo(() => {
    const map: Record<string, { key: string; count: number; total: number }> = {};
    rides.forEach((r) => {
      const k = dayKey(r.ts);
      if (!map[k]) map[k] = { key: k, count: 0, total: 0 };
      map[k].count += 1;
      map[k].total += r.amount;
    });
    return Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [rides]);

  const today = days.find((d) => d.key === todayKey) || { key: todayKey, count: 0, total: 0 };
  const todayRides = rides
    .filter((r) => dayKey(r.ts) === todayKey)
    .sort((a, b) => b.ts - a.ts);

  const todayOps = operations.filter((o) => dayKey(o.ts) === todayKey);
  const todayAdditions = totalOperations(operations, 'add');
  const todayDeductions = totalOperations(operations, 'deduct');
  const todayAPayer = today.total + todayAdditions - todayDeductions;

  const addRide = (): void => {
    const amount = parseInt(price, 10) || 0;
    setRides((prev) => [...prev, { id: String(Date.now()), ts: Date.now(), amount }]);
  };

  const removeRide = (id: string): void => {
    Alert.alert('Hamafa ity course ity?', '', [
      { text: 'Tsia', style: 'cancel' },
      { text: 'Fafana', style: 'destructive', onPress: () => setRides((p) => p.filter((r) => r.id !== id)) },
    ]);
  };

  const addOperation = (): void => {
    const amount = parseInt(opDesc, 10) || 0;
    if (amount === 0) return;
    setOperations((prev) => [
      ...prev,
      { id: String(Date.now()), ts: Date.now(), description: opDesc, amount, type: opType },
    ]);
    setOpDesc('');
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

  const grand = grandDays.reduce<
    { key: string; count: number; total: number; additions: number; deductions: number }
  >(
    (acc, d) => ({
      key: acc.key,
      count: acc.count + d.count,
      total: acc.total + d.total,
      additions: acc.additions + d.additions,
      deductions: acc.deductions + d.deductions,
    }),
    { key: '', count: 0, total: 0, additions: 0, deductions: 0 }
  );

  const overallAPayer = grand.total + grand.additions - grand.deductions;

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
        <View style={s.body}>
          <Text style={s.date}>{fmtDay(todayKey)}</Text>

          <View style={s.cards}>
            <View style={s.card}>
              <Text style={s.cardLabel}>Isan&#39;ny course</Text>
              <Text style={s.cardValue}>{today.count}</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>Totaly</Text>
              <Text style={s.cardValue}>{fmtMoney(today.total)}</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>Total additions</Text>
              <Text style={{ ...s.cardValue, color: '#10B981' }}>
                {fmtMoney(todayAdditions)}
              </Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>Total deductions</Text>
              <Text style={{ ...s.cardValue, color: '#EF4444' }}>
                {fmtMoney(todayDeductions)}
              </Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>Total &agrave; payer</Text>
              <Text style={{ ...s.cardValue, color: '#111827', fontSize: 24, fontWeight: '800' }}>
                {fmtMoney(todayAPayer)}
              </Text>
            </View>
          </View>

          <View style={s.priceRow}>
            <Text style={s.priceLabel}>Vidy isaky ny course:</Text>
            <TextInput
              style={s.input}
              value={price}
              onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
            />
            <Text style={s.priceLabel}>Ar</Text>
          </View>

          <TouchableOpacity style={s.bigBtn} onPress={addRide} activeOpacity={0.8}>
            <Text style={s.bigBtnTxt}>+ Course</Text>
          </TouchableOpacity>

          <View style={s.opForm}>
            <View style={s.opFormRow}>
              <TextInput
                style={s.opInput}
                value={opDesc}
                onChangeText={setOpDesc}
                placeholder="Description..."
                placeholderTextColor="#6B7280"
              />
              <View style={s.opTypeRow}>
                <TouchableOpacity
                  style={[{ padding: 8, borderRadius: 6, borderWidth: 2, borderColor: opType === 'add' ? '#10B981' : 'transparent', backgroundColor: opType === 'add' ? '#F0FDF4' : 'transparent' }, s.opTypeBtn]}
                  onPress={() => setOpType('add')}
                >
                  <Text style={s.opTypeTxt}>+</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[{ padding: 8, borderRadius: 6, borderWidth: 2, borderColor: opType === 'deduct' ? '#EF4444' : 'transparent', backgroundColor: opType === 'deduct' ? '#FEE2E2' : 'transparent' }, s.opTypeBtn]}
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

          <FlatList
            data={todayOps}
            keyExtractor={(o) => o.id}
            style={{ marginTop: 12 }}
            ListEmptyComponent={<Text style={s.empty}>Mbola tsy misy operation anio.</Text>}
            renderItem={({ item, index }) => (
              <View style={s.row}>
                <Text style={s.rowMain}>
                  {item.description} · {fmtTime(item.ts)}
                </Text>
                <Text style={[
                  { padding: 8, borderRadius: 6, backgroundColor: item.type === 'add' ? '#F0FDF4' : '#FEE2E2', color: item.type === 'add' ? '#10B981' : '#EF4444' },
                  { flex: 1, textAlign: 'right' },
                ]}>
                  {item.type === 'add' ? `+${fmtMoney(item.amount)}` : `-${fmtMoney(item.amount)}`}
                </Text>
                <TouchableOpacity onPress={() => removeOperation(item.id)}>
                  <Text style={s.del}>&times;</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      ) : (
        <View style={s.body}>
          <View style={s.cards}>
            <View style={s.card}>
              <Text style={s.cardLabel}>Course rehetra</Text>
              <Text style={s.cardValue}>{grand.count}</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>Totaly rehetra</Text>
              <Text style={s.cardValue}>{fmtMoney(grand.total)}</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>Total additions</Text>
              <Text style={{ ...s.cardValue, color: '#10B981' }}>
                {fmtMoney(grand.additions)}
              </Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>Total deductions</Text>
              <Text style={{ ...s.cardValue, color: '#EF4444' }}>
                {fmtMoney(grand.deductions)}
              </Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardLabel}>Total &agrave; payer</Text>
              <Text style={{ ...s.cardValue, color: '#111827', fontSize: 24, fontWeight: '800' }}>
                {fmtMoney(overallAPayer)}
              </Text>
            </View>
          </View>

          <FlatList
            data={grandDays}
            keyExtractor={(d) => d.key}
            ListEmptyComponent={<Text style={s.empty}>Tsy misy tantara.</Text>}
            renderItem={({ item }) => (
              <View style={s.row}>
                <Text style={s.rowMain}>{fmtDay(item.key)}</Text>
                <Text style={s.rowMain}>{item.count} course</Text>
                <Text style={[s.rowMain, { fontWeight: '700' }]}>{fmtMoney(item.total)}</Text>
                <Text style={{ ...s.rowMain, color: '#10B981' }}>
                  +{fmtMoney(item.additions)}
                </Text>
                <Text style={{ ...s.rowMain, color: '#EF4444' }}>
                  &minus;{fmtMoney(item.deductions)}
                </Text>
                <Text style={{ ...s.rowMain, fontWeight: '700' }}>{fmtMoney(item.total + item.additions - item.deductions)}</Text>
              </View>
            )}
          />

          <Text style={{ padding: 8, color: '#6B7280' }}>Total global</Text>
          <View style={s.row}>
            <Text style={s.rowMain}>Courses: {grand.count}</Text>
            <Text style={s.rowMain}>Income: {fmtMoney(grand.total)}</Text>
            <Text style={{ ...s.rowMain, color: '#10B981' }}>Additions: {fmtMoney(grand.additions)}</Text>
            <Text style={{ ...s.rowMain, color: '#EF4444' }}>Deductions: {fmtMoney(grand.deductions)}</Text>
            <Text style={{ ...s.rowMain, color: '#111827', fontWeight: '800' }}>
              Net: {fmtMoney(overallAPayer)}
            </Text>
          </View>
        </View>
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
  body: { flex: 1, padding: 16 },
  date: { fontSize: 16, color: '#374151', marginBottom: 8 },
  cards: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14 },
  cardLabel: { color: '#6B7280', fontSize: 12 },
  cardValue: { fontSize: 24, fontWeight: '800', color: '#111827', marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  priceLabel: { color: '#374151' },
  input: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 90, fontSize: 16 },
  bigBtn: { backgroundColor: '#16A34A', borderRadius: 16, paddingVertical: 22, alignItems: 'center' },
  bigBtnTxt: { color: '#fff', fontSize: 28, fontWeight: '800' },
  row: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowMain: { color: '#111827', fontSize: 15 },
  del: { color: '#DC2626', fontSize: 18, paddingHorizontal: 8 },
  empty: { textAlign: 'center', color: '#9CA3AF', marginTop: 24 },
  opForm: { marginTop: 12, padding: 12, backgroundColor: '#fff', borderRadius: 12 },
  opFormRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  opInput: { flex: 1, backgroundColor: '#fff', borderRadius: 8, padding: 8, fontSize: 14 },
  opTypeRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  opTypeBtn: { minWidth: 40 },
  opTypeTxt: { fontSize: 18, fontWeight: '700' },
  opBtn: { backgroundColor: '#16A34A', borderRadius: 16, paddingVertical: 12, alignItems: 'center', marginTop: 8, marginHorizontal: 0 },
  opBtnTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
});