/**
 * In-memory stand-in for PrismaClient, generated from the REAL schema (Prisma.dmmf):
 * field names, enums, defaults, @updatedAt, unique + compound-unique constraints (P2002),
 * relations (include / nested create) and increment/decrement are all enforced from the schema.
 * `$transaction(fn)` is serialised and rolled back on error, which is equivalent to SERIALIZABLE
 * isolation – stricter than Postgres' default, so races are tested pessimistically.
 *
 * It exists so the complete HTTP stack (auth → routes → services) can be tested in sandboxes
 * without a database. It is NOT a replacement for running against Postgres (see TESTING.md).
 */
import { Prisma } from "@prisma/client";

type Row = Record<string, any>;
const dm = (Prisma as any).dmmf.datamodel as {
  models: { name: string; fields: any[]; uniqueIndexes: { name: string | null; fields: string[] }[]; uniqueFields: string[][]; primaryKey: any }[];
};
const MODELS = new Map(dm.models.map((m) => [m.name, m]));
const lower = (s: string) => s[0].toLowerCase() + s.slice(1);
const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));

class PrismaKnownError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "PrismaClientKnownRequestError"; }
}

export function createMemoryPrisma() {
  let store = new Map<string, Row[]>(dm.models.map((m) => [m.name, []]));
  let idCounter = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const rows = (model: string) => store.get(model)!;
  const fieldsOf = (model: string) => MODELS.get(model)!.fields;
  const scalar = (model: string, name: string) => fieldsOf(model).find((f) => f.name === name && f.kind !== "object");
  const relation = (model: string, name: string) => fieldsOf(model).find((f) => f.name === name && f.kind === "object");

  const compoundKeys = (model: string) => {
    const m = MODELS.get(model)!;
    const out: { key: string; fields: string[] }[] = [];
    for (const u of m.uniqueIndexes) out.push({ key: u.name ?? u.fields.join("_"), fields: u.fields });
    for (const u of m.uniqueFields) out.push({ key: u.join("_"), fields: u });
    if (m.primaryKey) out.push({ key: m.primaryKey.name ?? m.primaryKey.fields.join("_"), fields: m.primaryKey.fields });
    return out;
  };

  function matchOp(v: any, cond: any): boolean {
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return eq(v, cond);
    for (const [op, arg] of Object.entries(cond)) {
      switch (op) {
        case "equals": if (!eq(v, arg)) return false; break;
        case "not": if (matchOp(v, arg)) return false; break;
        case "in": if (!(arg as any[]).some((a) => eq(v, a))) return false; break;
        case "notIn": if ((arg as any[]).some((a) => eq(v, a))) return false; break;
        case "gte": if (!(v >= (arg as any))) return false; break;
        case "gt": if (!(v > (arg as any))) return false; break;
        case "lte": if (!(v <= (arg as any))) return false; break;
        case "lt": if (!(v < (arg as any))) return false; break;
        case "startsWith": if (typeof v !== "string" || !v.startsWith(arg as string)) return false; break;
        case "contains": if (typeof v !== "string" || !v.includes(arg as string)) return false; break;
        case "endsWith": if (typeof v !== "string" || !v.endsWith(arg as string)) return false; break;
        case "mode": break;
        default: throw new Error(`memoryPrisma: unsupported filter op "${op}"`);
      }
    }
    return true;
  }
  const eq = (a: any, b: any) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

  function matches(model: string, row: Row, where: any = {}): boolean {
    for (const [k, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (k === "AND") { if (!([] as any[]).concat(cond).every((w) => matches(model, row, w))) return false; continue; }
      if (k === "OR") { if (!(cond as any[]).some((w) => matches(model, row, w))) return false; continue; }
      if (k === "NOT") { if (([] as any[]).concat(cond).some((w) => matches(model, row, w))) return false; continue; }
      const sf = scalar(model, k);
      if (sf) { if (!matchOp(row[k], cond)) return false; continue; }
      const ck = compoundKeys(model).find((c) => c.key === k);
      if (ck) { for (const f of ck.fields) if (!eq(row[f], (cond as any)[f])) return false; continue; }
      throw new Error(`memoryPrisma: unknown where key "${k}" on ${model}`);
    }
    return true;
  }

  function applyDefaults(model: string, data: Row): Row {
    const row: Row = {};
    for (const f of fieldsOf(model)) {
      if (f.kind === "object") continue;
      let v = data[f.name];
      if (v === undefined) {
        if (f.hasDefaultValue) {
          const d = f.default;
          if (d && typeof d === "object" && !Array.isArray(d)) {
            if (d.name === "cuid" || d.name === "uuid") v = `c${(++idCounter).toString(36).padStart(8, "0")}${Math.random().toString(36).slice(2, 8)}`;
            else if (d.name === "now") v = new Date();
            else if (d.name === "autoincrement") v = ++idCounter;
            else throw new Error(`memoryPrisma: default ${d.name} unsupported`);
          } else v = clone(d);
        } else if (f.isUpdatedAt) v = new Date();
        else if (f.isList) v = [];
        else if (!f.isRequired) v = null;
        else throw new Error(`memoryPrisma: ${model}.${f.name} is required`);
      }
      row[f.name] = v;
    }
    return row;
  }

  function assertUnique(model: string, row: Row, ignore?: Row) {
    const others = rows(model).filter((r) => r !== ignore);
    const sets = [...compoundKeys(model).map((c) => c.fields), ...fieldsOf(model).filter((f) => f.isUnique || f.isId).map((f) => [f.name])];
    for (const fields of sets) {
      if (fields.some((f) => row[f] === null || row[f] === undefined)) continue;
      if (others.some((o) => fields.every((f) => eq(o[f], row[f]))))
        throw new PrismaKnownError("P2002", `Unique constraint failed on ${model}(${fields.join(",")})`);
    }
  }

  function relationInfo(model: string, relField: any) {
    // returns FK description between `model` and the related model
    const other = MODELS.get(relField.type)!;
    const back = other.fields.find((f) => f.relationName === relField.relationName && (f.name !== relField.name || relField.type !== model));
    if (relField.relationFromFields?.length) return { fkOnThis: true, fk: relField.relationFromFields as string[], ref: relField.relationToFields as string[], other: relField.type };
    return { fkOnThis: false, fk: back.relationFromFields as string[], ref: back.relationToFields as string[], other: relField.type };
  }

  function create(model: string, data: Row): Row {
    const scalars: Row = {}; const nested: [any, any][] = [];
    for (const [k, v] of Object.entries(data)) {
      const rf = relation(model, k);
      if (rf) nested.push([rf, v]); else scalars[k] = v;
    }
    // FK-on-this relations (connect) must resolve before the row is built
    for (const [rf, v] of nested) {
      const info = relationInfo(model, rf);
      if (info.fkOnThis && (v as any).connect) {
        const target = rows(info.other).find((r) => matches(info.other, r, (v as any).connect));
        if (!target) throw new PrismaKnownError("P2025", "connect target not found");
        info.fk.forEach((f, i) => (scalars[f] = target[info.ref[i]]));
      }
    }
    const row = applyDefaults(model, scalars);
    assertUnique(model, row);
    rows(model).push(row);
    for (const [rf, v] of nested) {
      const info = relationInfo(model, rf);
      if (info.fkOnThis) continue;
      const list = ([] as any[]).concat((v as any).create ?? []);
      for (const child of list) create(info.other, { ...child, ...Object.fromEntries(info.fk.map((f, i) => [f, row[info.ref[i]]])) });
    }
    return row;
  }

  function applyUpdate(model: string, row: Row, data: Row) {
    const next = { ...row };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (!scalar(model, k)) throw new Error(`memoryPrisma: cannot update "${k}" on ${model}`);
      if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && ("increment" in v || "decrement" in v || "set" in v)) {
        const o = v as any;
        if ("set" in o) next[k] = o.set;
        if ("increment" in o) next[k] = (next[k] ?? 0) + o.increment;
        if ("decrement" in o) next[k] = (next[k] ?? 0) - o.decrement;
      } else next[k] = clone(v);
    }
    for (const f of fieldsOf(model)) if (f.isUpdatedAt) next[f.name] = new Date();
    assertUnique(model, next, row);
    Object.assign(row, next);
  }

  function shape(model: string, row: Row | null, args: any = {}): any {
    if (!row) return null;
    const out: Row = {};
    const sel = args.select as Row | undefined;
    for (const f of fieldsOf(model)) {
      if (f.kind === "object") continue;
      if (!sel || sel[f.name]) out[f.name] = clone(row[f.name]);
    }
    const wanted: Row = { ...(args.include ?? {}) };
    if (sel) for (const [k, v] of Object.entries(sel)) if (v && relation(model, k)) wanted[k] = v;
    for (const [name, spec] of Object.entries(wanted)) {
      if (!spec || name === "_count") continue;
      const rf = relation(model, name);
      const info = relationInfo(model, rf);
      const related = rows(info.other).filter((r) => info.fk.every((f, i) => (info.fkOnThis ? eq(r[info.ref[i]], row[f]) : eq(r[f], row[info.ref[i]]))));
      const sub = spec === true ? {} : (spec as any);
      const filtered = sub.where ? related.filter((r) => matches(info.other, r, sub.where)) : related;
      const mapped = filtered.map((r) => shape(info.other, r, sub));
      out[name] = rf.isList ? mapped : mapped[0] ?? null;
    }
    const count = args.include?._count ?? sel?._count;
    if (count) {
      out._count = {};
      for (const k of Object.keys(count.select ?? {})) {
        const rf = relation(model, k); const info = relationInfo(model, rf);
        out._count[k] = rows(info.other).filter((r) => info.fk.every((f, i) => eq(r[f], row[info.ref[i]]))).length;
      }
    }
    return out;
  }

  const order = (list: Row[], orderBy: any) => {
    if (!orderBy) return list;
    const specs = ([] as any[]).concat(orderBy).flatMap((o) => Object.entries(o)) as [string, "asc" | "desc"][];
    return [...list].sort((a, b) => {
      for (const [f, dir] of specs) { if (a[f] < b[f]) return dir === "asc" ? -1 : 1; if (a[f] > b[f]) return dir === "asc" ? 1 : -1; }
      return 0;
    });
  };

  const delegate = (model: string) => ({
    findUnique: async (a: any) => shape(model, rows(model).find((r) => matches(model, r, a.where)) ?? null, a),
    findFirst: async (a: any = {}) => shape(model, order(rows(model).filter((r) => matches(model, r, a.where)), a.orderBy)[0] ?? null, a),
    findMany: async (a: any = {}) => {
      let list = order(rows(model).filter((r) => matches(model, r, a.where)), a.orderBy);
      if (a.skip) list = list.slice(a.skip);
      if (a.take !== undefined) list = list.slice(0, a.take);
      return list.map((r) => shape(model, r, a));
    },
    count: async (a: any = {}) => rows(model).filter((r) => matches(model, r, a.where)).length,
    create: async (a: any) => shape(model, create(model, a.data), a),
    createMany: async (a: any) => { for (const d of a.data) create(model, d); return { count: a.data.length }; },
    update: async (a: any) => {
      const row = rows(model).find((r) => matches(model, r, a.where));
      if (!row) throw new PrismaKnownError("P2025", `${model} not found`);
      applyUpdate(model, row, a.data); return shape(model, row, a);
    },
    updateMany: async (a: any) => {
      const hit = rows(model).filter((r) => matches(model, r, a.where));
      hit.forEach((r) => applyUpdate(model, r, a.data)); return { count: hit.length };
    },
    upsert: async (a: any) => {
      const row = rows(model).find((r) => matches(model, r, a.where));
      if (row) { applyUpdate(model, row, a.update); return shape(model, row, a); }
      return shape(model, create(model, a.create), a);
    },
    delete: async (a: any) => {
      const i = rows(model).findIndex((r) => matches(model, r, a.where));
      if (i < 0) throw new PrismaKnownError("P2025", `${model} not found`);
      const [r] = rows(model).splice(i, 1); return shape(model, r, a);
    },
    deleteMany: async (a: any = {}) => {
      const keep = rows(model).filter((r) => !matches(model, r, a.where));
      const n = rows(model).length - keep.length; store.set(model, keep); return { count: n };
    },
  });

  const client: Record<string, any> = {};
  for (const m of dm.models) client[lower(m.name)] = delegate(m.name);

  client.$transaction = async (arg: any) => {
    const run = async () => {
      const snapshot = new Map([...store].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
      try {
        return Array.isArray(arg) ? await Promise.all(arg) : await arg(client);
      } catch (e) { store = snapshot; throw e; }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => undefined);
    return p;
  };
  client.$disconnect = async () => undefined;
  client.$reset = () => { store = new Map(dm.models.map((m) => [m.name, []])); };
  client.$rows = (model: string) => rows(model);
  return client as any;
}
