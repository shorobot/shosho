"use client";

// One realtime subscription per tab, shared by the board, the detail view, the kitchen and the driver
// screens (api-contracts §3 / §6.1): initial load by scope, then `postgres_changes` on orders /
// order_items / order_events → re-fetch the affected order row (never diff locally).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useSupabase } from "@/components/providers/EnvProvider";
import { ACTIVE, KITCHEN_STATUSES, upsertOrder } from "@/lib/orders";
import { chime } from "@/lib/sound";
import { startOfDay } from "@/lib/time";
import { ORDER_SELECT, type KitchenSettings, type KitchenStatus, type OpsSettings, type Order, type Staff, type StaffRole } from "@/lib/types";

export type Connection = "connecting" | "live" | "lost";

export type Settings = { ops: OpsSettings; kitchen: KitchenSettings; kitchenStatus: KitchenStatus };

export type OrdersStore = {
  me: Staff;
  orders: Order[];
  loading: boolean;
  error: string | null;
  connection: Connection;
  lastUpdate: Date | null;
  staff: Staff[];
  settings: Settings;
  now: Date;
  reload: () => Promise<void>;
  reconnect: () => void;
  refetchOrder: (id: string) => Promise<Order | null>;
  applyRow: (row: Order) => void;
  reloadSettings: () => Promise<void>;
};

const Ctx = createContext<OrdersStore | null>(null);

const EMPTY_SETTINGS: Settings = { ops: {}, kitchen: {}, kitchenStatus: {} };

export function OrdersProvider({ me, children }: { me: Staff; children: ReactNode }) {
  const supabase = useSupabase();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [now, setNow] = useState(() => new Date());
  const [epoch, setEpoch] = useState(0);
  const known = useRef<Map<string, Order["status"]>>(new Map());
  const pending = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // clock for timers (1 s)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const role: StaffRole = me.role;

  const scopedQuery = useCallback(() => {
    const q = supabase.from("orders").select(ORDER_SELECT);
    if (role === "kitchen") return q.in("status", KITCHEN_STATUSES).order("created_at", { ascending: true });
    if (role === "driver") return q.in("status", ["ready", "out_for_delivery"]).order("created_at", { ascending: true });
    const today = startOfDay(new Date()).toISOString();
    // Everything the board shows: created today, still active, finished/cancelled today (an order taken
    // yesterday and handed out this morning belongs in "Erledigt heute"), or a pending pre-order.
    return q
      .or(
        `created_at.gte.${today},completed_at.gte.${today},cancelled_at.gte.${today},status.in.(${ACTIVE.join(",")}),and(scheduled_for.not.is.null,status.in.(new,accepted))`,
      )
      .order("created_at", { ascending: false })
      .limit(500);
  }, [supabase, role]);

  const notice = useCallback(
    (rows: Order[]) => {
      // sound: a row we did not know yet in the state this role cares about
      let ring = false;
      for (const o of rows) {
        const prev = known.current.get(o.id);
        if (role === "kitchen") {
          if (o.status === "accepted" && prev !== "accepted" && prev !== "preparing" && prev !== "ready") ring = true;
        } else if (role === "driver") {
          if ((o.status === "ready" || o.status === "out_for_delivery") && prev === undefined) ring = true;
        } else if (o.status === "new" && prev === undefined) ring = true;
        known.current.set(o.id, o.status);
      }
      return ring;
    },
    [role],
  );

  const reload = useCallback(async () => {
    const { data, error } = await scopedQuery();
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as Order[];
    const first = known.current.size === 0;
    const ring = notice(rows);
    setOrders(rows);
    setError(null);
    setLoading(false);
    setLastUpdate(new Date());
    if (ring && !first) chime();
  }, [scopedQuery, notice]);

  const refetchOrder = useCallback(
    async (id: string): Promise<Order | null> => {
      const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle();
      if (error) return null;
      const row = (data as Order | null) ?? null;
      if (row && notice([row])) chime();
      setOrders((list) => upsertOrder(list, row, id));
      setLastUpdate(new Date());
      return row;
    },
    [supabase, notice],
  );

  const applyRow = useCallback((row: Order) => {
    known.current.set(row.id, row.status);
    setOrders((list) => upsertOrder(list, row, row.id));
  }, []);

  const reloadSettings = useCallback(async () => {
    const { data } = await supabase.from("settings").select("key, value").in("key", ["ops", "kitchen", "kitchen.status"]);
    if (!data) return;
    const by = Object.fromEntries(data.map((r) => [r.key, r.value])) as Record<string, unknown>;
    setSettings({
      ops: (by["ops"] as OpsSettings) ?? {},
      kitchen: (by["kitchen"] as KitchenSettings) ?? {},
      kitchenStatus: (by["kitchen.status"] as KitchenStatus) ?? {},
    });
  }, [supabase]);

  // staff (for the driver picker + timeline actor names). Kitchen/driver may only read their own row.
  useEffect(() => {
    let alive = true;
    supabase
      .from("staff")
      .select("id, name, role, active")
      .then(({ data }) => alive && data && setStaff(data));
    void reloadSettings();
    const id = setInterval(() => void reloadSettings(), 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [supabase, reloadSettings]);

  // initial load + realtime; `epoch` bumps on reconnect()
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let alive = true;
    setConnection("connecting");
    void reload();

    const schedule = (id: string) => {
      const prev = pending.current.get(id);
      if (prev) clearTimeout(prev);
      pending.current.set(
        id,
        setTimeout(() => {
          pending.current.delete(id);
          void refetchOrder(id);
        }, 150),
      );
    };

    channel = supabase
      .channel(`orders-${epoch}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        const id = (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id;
        if (id) schedule(id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, (p) => {
        const id = (p.new as { order_id?: string })?.order_id ?? (p.old as { order_id?: string })?.order_id;
        if (id) schedule(id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events" }, (p) => {
        const id = (p.new as { order_id?: string })?.order_id ?? (p.old as { order_id?: string })?.order_id;
        if (id) schedule(id);
      })
      .subscribe((status) => {
        if (!alive) return;
        if (status === "SUBSCRIBED") {
          setConnection("live");
          void reload(); // anything that happened while (re)connecting
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("lost");
        }
      });

    // safety net: a full reload every 60 s (day boundary, missed events)
    const tick = setInterval(() => void reload(), 60000);
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, epoch]);

  const reconnect = useCallback(() => setEpoch((e) => e + 1), []);

  const value = useMemo<OrdersStore>(
    () => ({ me, orders, loading, error, connection, lastUpdate, staff, settings, now, reload, reconnect, refetchOrder, applyRow, reloadSettings }),
    [me, orders, loading, error, connection, lastUpdate, staff, settings, now, reload, reconnect, refetchOrder, applyRow, reloadSettings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrders(): OrdersStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrders outside <OrdersProvider>");
  return v;
}
