"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { useT } from "@/lib/i18n";
import { useOrders } from "@/lib/store";
import type { Order } from "@/lib/types";

/** ready → out_for_delivery needs an active driver (set_order_status raises `driver_required` otherwise). */
export function DriverDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const t = useT();
  const { staff } = useOrders();
  const { run, busy } = useOrderAction();
  const drivers = staff.filter((s) => s.role === "driver" && s.active);
  const [picked, setPicked] = useState<string>("");
  const driverId = picked || order.driver_id || drivers[0]?.id || "";

  return (
    <Modal open={open} onClose={onClose} title={t("driver.title")}>
      {drivers.length === 0 ? (
        <p className="text-[13px] leading-[1.55] text-ink-3">{t("driver.none")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="label-caps mb-1">{t("driver.pick")}</legend>
            {drivers.map((d) => (
              <label key={d.id} className={`flex cursor-pointer items-center gap-3 rounded-[14px] px-3.5 py-3 transition-micro ${driverId === d.id ? "bg-orange-tint outline outline-2 outline-orange" : "bg-field-2"}`}>
                <input type="radio" name="driver" className="accent-orange" checked={driverId === d.id} onChange={() => setPicked(d.id)} />
                <span className="text-[13px] font-extrabold">{d.name}</span>
              </label>
            ))}
          </fieldset>
          <Pill
            size="lg"
            className="w-full"
            disabled={!driverId || busy === order.id}
            onClick={async () => {
              const ok = await run(order, "out_for_delivery", { driver_id: driverId });
              if (ok) onClose();
            }}
          >
            {t("driver.confirm", { n: order.number })}
          </Pill>
        </div>
      )}
    </Modal>
  );
}
