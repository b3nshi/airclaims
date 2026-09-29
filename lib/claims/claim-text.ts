// Prepared claim text the passenger pastes into the airline's web form (or that seeds the
// email draft). Written in the airline's language; always asks for payment in money.
import type { DisruptionType, ExpenseCategory } from "@/lib/supabase/database.types";

export type ClaimTextInput = {
  airlineLanguage: string;
  airlineName: string;
  flight: string;
  flightDate: string; // YYYY-MM-DD
  departure: string; // "Barcelona (BCN)"
  arrival: string;
  finalDestination: string;
  bookingReference: string | null;
  disruption: DisruptionType;
  arrivalDelayMinutes: number | null;
  cancellationNoticeDays: number | null;
  perPassengerEur: number | null;
  totalEur: number | null;
  passengers: string[]; // paid tickets only; first is the lead
  expenses: { category: ExpenseCategory; amount: number; currency: string }[];
  staffInstructions: string | null;
  aliasEmail: string;
  departsSpain: boolean; // AESA is the enforcement body for flights from Spain
};

type Lang = "en" | "es";

const T = {
  en: {
    subject: (f: string, d: string) => `EU261 compensation claim – flight ${f} on ${d}`,
    greeting: (a: string) => `Dear ${a} Customer Relations,`,
    intro: (f: string, from: string, to: string, d: string, pnr: string | null) =>
      `I am writing to claim compensation under Regulation (EC) No 261/2004 for flight ${f} from ${from} to ${to} on ${d}${pnr ? ` (booking reference ${pnr})` : ""}.`,
    delay: (dest: string, h: number, m: number) =>
      `The flight arrived at my final destination, ${dest}, ${h} hours and ${m} minutes late.`,
    missed: (dest: string, h: number, m: number) =>
      `Because of the delay I missed my connection and reached my final destination, ${dest}, ${h} hours and ${m} minutes late.`,
    delayUnknown: (dest: string) => `The flight arrived at my final destination, ${dest}, more than three hours late.`,
    cancellation: (n: number | null) =>
      n === null ? "The flight was cancelled." : `The flight was cancelled and I was informed ${n} days before departure.`,
    denied: "I was denied boarding against my will.",
    legal: {
      delay: "Under Articles 6 and 7 of the Regulation, as interpreted by the Court of Justice of the EU in Sturgeon (C-402/07 and C-432/07), each passenger is entitled to compensation",
      missed_connection: "Under Articles 6 and 7 of the Regulation, as interpreted by the Court of Justice of the EU in Sturgeon (C-402/07 and C-432/07) and Folkerts (C-11/11), each passenger is entitled to compensation",
      cancellation: "Under Articles 5 and 7 of the Regulation, each passenger is entitled to compensation",
      denied_boarding: "Under Articles 4 and 7 of the Regulation, each passenger is entitled to compensation",
    },
    amount: (per: number | null, total: number | null) =>
      per !== null && total !== null
        ? ` of €${per}. I claim a total of €${total} for the following passengers:`
        : ". I claim the compensation set out in Article 7 for the following passengers:",
    expensesIntro:
      "I also request reimbursement of the following expenses caused by the disruption (Articles 8 and 9); receipts are attached:",
    categories: {
      ground_transport: "Ground transport", meal: "Meals", hotel: "Hotel", phone: "Phone calls",
      rebooking: "Alternative flight", other: "Other",
    },
    instructions: (s: string) => `Your staff told us at the airport: "${s}"`,
    payment:
      "Please pay these amounts in money, by bank transfer. I do not accept vouchers, travel credit or miles.",
    reply: (alias: string) => `Please reply within one month to ${alias}.`,
    escalate: (aesa: boolean) =>
      `If I do not receive a satisfactory answer, I will refer the matter to ${aesa ? "the Spanish Aviation Safety Agency (AESA)" : "the competent national enforcement body"}.`,
    closing: "Yours sincerely,",
  },
  es: {
    subject: (f: string, d: string) => `Reclamación de compensación EU261 – vuelo ${f} del ${d}`,
    greeting: (a: string) => `Estimado servicio de atención al cliente de ${a}:`,
    intro: (f: string, from: string, to: string, d: string, pnr: string | null) =>
      `Les escribo para reclamar la compensación prevista en el Reglamento (CE) n.º 261/2004 por el vuelo ${f} de ${from} a ${to} del ${d}${pnr ? ` (localizador ${pnr})` : ""}.`,
    delay: (dest: string, h: number, m: number) =>
      `El vuelo llegó a mi destino final, ${dest}, con ${h} horas y ${m} minutos de retraso.`,
    missed: (dest: string, h: number, m: number) =>
      `Debido al retraso perdí mi conexión y llegué a mi destino final, ${dest}, con ${h} horas y ${m} minutos de retraso.`,
    delayUnknown: (dest: string) => `El vuelo llegó a mi destino final, ${dest}, con más de tres horas de retraso.`,
    cancellation: (n: number | null) =>
      n === null ? "El vuelo fue cancelado." : `El vuelo fue cancelado y se me informó ${n} días antes de la salida.`,
    denied: "Se me denegó el embarque contra mi voluntad.",
    legal: {
      delay: "Según los artículos 6 y 7 del Reglamento, interpretados por el Tribunal de Justicia de la UE en la sentencia Sturgeon (C-402/07 y C-432/07), cada pasajero tiene derecho a una compensación",
      missed_connection: "Según los artículos 6 y 7 del Reglamento, interpretados por el Tribunal de Justicia de la UE en las sentencias Sturgeon (C-402/07 y C-432/07) y Folkerts (C-11/11), cada pasajero tiene derecho a una compensación",
      cancellation: "Según los artículos 5 y 7 del Reglamento, cada pasajero tiene derecho a una compensación",
      denied_boarding: "Según los artículos 4 y 7 del Reglamento, cada pasajero tiene derecho a una compensación",
    },
    amount: (per: number | null, total: number | null) =>
      per !== null && total !== null
        ? ` de ${per} €. Reclamo un total de ${total} € para los siguientes pasajeros:`
        : ". Reclamo la compensación prevista en el artículo 7 para los siguientes pasajeros:",
    expensesIntro:
      "Solicito además el reembolso de los siguientes gastos ocasionados por la incidencia (artículos 8 y 9); adjunto los justificantes:",
    categories: {
      ground_transport: "Transporte terrestre", meal: "Comidas", hotel: "Hotel", phone: "Llamadas",
      rebooking: "Vuelo alternativo", other: "Otros",
    },
    instructions: (s: string) => `Su personal nos indicó en el aeropuerto: «${s}»`,
    payment:
      "Les ruego que abonen estos importes en dinero, mediante transferencia bancaria. No acepto bonos, créditos de viaje ni millas.",
    reply: (alias: string) => `Les ruego que respondan en el plazo de un mes a ${alias}.`,
    escalate: (aesa: boolean) =>
      `Si no recibo una respuesta satisfactoria, acudiré a ${aesa ? "la Agencia Estatal de Seguridad Aérea (AESA)" : "el organismo nacional competente"}.`,
    closing: "Atentamente,",
  },
} satisfies Record<Lang, unknown>;

export function buildClaimText(input: ClaimTextInput): { subject: string; body: string } {
  const lang: Lang = input.airlineLanguage === "es" ? "es" : "en";
  const t = T[lang];
  const money = (n: number, currency: string) =>
    new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-GB", { style: "currency", currency }).format(n);
  const delay = input.arrivalDelayMinutes;

  const facts =
    input.disruption === "cancellation"
      ? t.cancellation(input.cancellationNoticeDays)
      : input.disruption === "denied_boarding"
        ? t.denied
        : delay === null
          ? t.delayUnknown(input.finalDestination)
          : (input.disruption === "missed_connection" ? t.missed : t.delay)(
              input.finalDestination,
              Math.floor(delay / 60),
              delay % 60,
            );

  const paragraphs = [
    t.greeting(input.airlineName),
    t.intro(input.flight, input.departure, input.arrival, input.flightDate, input.bookingReference),
    facts,
    t.legal[input.disruption] + t.amount(input.perPassengerEur, input.totalEur) + "\n" +
      input.passengers.map((p) => `- ${p}`).join("\n"),
  ];
  if (input.expenses.length) {
    paragraphs.push(
      t.expensesIntro + "\n" +
        input.expenses.map((e) => `- ${t.categories[e.category]}: ${money(e.amount, e.currency)}`).join("\n"),
    );
  }
  if (input.staffInstructions) paragraphs.push(t.instructions(input.staffInstructions));
  paragraphs.push(t.payment, t.reply(input.aliasEmail) + " " + t.escalate(input.departsSpain));
  paragraphs.push(`${t.closing}\n${input.passengers[0] ?? ""}`);

  return { subject: t.subject(input.flight, input.flightDate), body: paragraphs.join("\n\n") };
}
