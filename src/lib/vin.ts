/** The first three characters of a VIN (the WMI) identify the manufacturer. Common makes for this workshop. */
const WMI: Record<string, string> = {
  WP0: "Porsche", WP1: "Porsche", WP2: "Porsche",
  SCB: "Bentley", SJA: "Bentley",
  SCA: "Rolls-Royce",
  ZHW: "Lamborghini",
  ZFF: "Ferrari",
  SCF: "Aston Martin",
  ZAM: "Maserati", ZN6: "Maserati",
  SBM: "McLaren",
  WDD: "Mercedes-Benz", WDC: "Mercedes-Benz", WDB: "Mercedes-Benz", W1K: "Mercedes-Benz", W1N: "Mercedes-Benz", W1V: "Mercedes-Benz", "4JG": "Mercedes-Benz",
  WBA: "BMW", WBS: "BMW", WBY: "BMW", WBX: "BMW", "5UX": "BMW",
  WAU: "Audi", WA1: "Audi", WUA: "Audi", TRU: "Audi",
  SAL: "Land Rover", SAJ: "Jaguar",
  JTH: "Lexus", JTJ: "Lexus",
  JTE: "Toyota", JTM: "Toyota", JTD: "Toyota", JTN: "Toyota", JT3: "Toyota",
  JN1: "Nissan", JN8: "Nissan", "5N1": "Nissan",
  "1G1": "Chevrolet", "1GC": "Chevrolet", "1G6": "Cadillac",
  "1FA": "Ford", "1FT": "Ford", "1FM": "Ford",
  "2C3": "Dodge", "1C4": "Jeep", "1C6": "Ram",
  "5YJ": "Tesla", "7SA": "Tesla", LRW: "Tesla",
  KNA: "Kia", KMH: "Hyundai",
  WVW: "Volkswagen", WVG: "Volkswagen",
};

/** Make name suggested by a VIN, or null if unknown. */
export function makeFromVin(vin: string): string | null {
  const v = vin.trim().toUpperCase();
  if (v.length < 3) return null;
  return WMI[v.slice(0, 3)] ?? null;
}
