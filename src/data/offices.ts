import type { OfficeDefinition } from "./types";

export const offices: OfficeDefinition[] = [
  {
    id: "chairman",
    label: "Chairman",
    category: "chairman",
    operationOrder: 1,
    source: "board_image-1.png",
    notes: ["First red-ribbon Company Operation office."],
  },
  {
    id: "director-of-trade",
    label: "Director of Trade",
    category: "company",
    operationOrder: 2,
    hiring: {
      hirer: "chairman",
      candidatePool: {
        type: "special",
        rule: "director-of-trade-promotion-then-writers",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "board_image-1.png",
    notes: ["Second red-ribbon Company Operation office."],
  },
  {
    id: "manager-of-shipping",
    label: "Manager of Shipping",
    category: "company",
    operationOrder: 3,
    hiring: {
      hirer: "chairman",
      candidatePool: {
        type: "writers",
        presidencies: "any",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "board_image-1.png",
    notes: ["Third red-ribbon Company Operation office."],
  },
  {
    id: "military-affairs",
    label: "Military Affairs",
    category: "company",
    operationOrder: 4,
    hiring: {
      hirer: "chairman",
      candidatePool: {
        type: "special",
        rule: "military-affairs",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "board_image-1.png",
    notes: ["Fourth red-ribbon Company Operation office."],
  },
  {
    id: "president-bombay",
    label: "Presidency of Bombay",
    category: "presidency",
    operationOrder: 5,
    presidency: "bombay",
    hiring: {
      hirer: {
        type: "office",
        officeId: "director-of-trade",
      },
      candidatePool: {
        type: "special",
        rule: "president",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "board_image-1.png",
    notes: ["Bombay Presidency operation office."],
  },
  {
    id: "president-madras",
    label: "Presidency of Madras",
    category: "presidency",
    operationOrder: 6,
    presidency: "madras",
    hiring: {
      hirer: {
        type: "office",
        officeId: "director-of-trade",
      },
      candidatePool: {
        type: "special",
        rule: "president",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "board_image-1.png",
    notes: ["Madras Presidency operation office."],
  },
  {
    id: "president-bengal",
    label: "Presidency of Bengal",
    category: "presidency",
    operationOrder: 7,
    presidency: "bengal",
    hiring: {
      hirer: {
        type: "office",
        officeId: "director-of-trade",
      },
      candidatePool: {
        type: "special",
        rule: "president",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "board_image-1.png",
    notes: ["Bengal Presidency operation office."],
  },
  {
    id: "superintendent-of-trade-in-china",
    label: "Superintendent of Trade in China",
    category: "china",
    operationOrder: 8,
    hiring: {
      hirer: "chairman",
      candidatePool: {
        type: "writers",
        presidencies: "any",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "board_image-1.png",
    notes: ["China office opens after the Presidency offices in the red-ribbon sequence."],
  },
  {
    id: "governor-general",
    label: "Governor General",
    category: "governorGeneral",
    hiring: {
      hirer: "chairman",
      candidatePool: {
        type: "special",
        rule: "director-of-trade-promotion-then-writers",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Office card exists but is not always in play."],
  },
  {
    id: "governor-bengal",
    label: "Governor of Bengal",
    category: "governor",
    presidency: "bengal",
    region: "bengal",
    hiring: {
      hirer: {
        type: "office",
        officeId: "president-bengal",
      },
      candidatePool: {
        type: "special",
        rule: "governor",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Governor office for the Bengal region."],
  },
  {
    id: "governor-delhi",
    label: "Governor of Delhi",
    category: "governor",
    presidency: "bengal",
    region: "delhi",
    hiring: {
      hirer: {
        type: "office",
        officeId: "president-bengal",
      },
      candidatePool: {
        type: "special",
        rule: "governor",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Governor office for the Delhi region."],
  },
  {
    id: "governor-bombay",
    label: "Governor of Bombay",
    category: "governor",
    presidency: "bombay",
    region: "bombay",
    hiring: {
      hirer: {
        type: "office",
        officeId: "president-bombay",
      },
      candidatePool: {
        type: "special",
        rule: "governor",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Governor office for the Bombay region."],
  },
  {
    id: "governor-punjab",
    label: "Governor of Punjab",
    category: "governor",
    presidency: "bombay",
    region: "punjab",
    hiring: {
      hirer: {
        type: "office",
        officeId: "president-bombay",
      },
      candidatePool: {
        type: "special",
        rule: "governor",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Governor office for the Punjab region."],
  },
  {
    id: "governor-maratha",
    label: "Governor of Maratha",
    category: "governor",
    presidency: "bombay",
    region: "maratha",
    hiring: {
      hirer: {
        type: "office",
        officeId: "president-bombay",
      },
      candidatePool: {
        type: "special",
        rule: "governor",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Governor office for the Maratha region."],
  },
  {
    id: "governor-madras",
    label: "Governor of Madras",
    category: "governor",
    presidency: "madras",
    region: "madras",
    hiring: {
      hirer: {
        type: "office",
        officeId: "president-madras",
      },
      candidatePool: {
        type: "special",
        rule: "governor",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Governor office for the Madras region."],
  },
  {
    id: "governor-mysore",
    label: "Governor of Mysore",
    category: "governor",
    presidency: "madras",
    region: "mysore",
    hiring: {
      hirer: {
        type: "office",
        officeId: "president-madras",
      },
      candidatePool: {
        type: "special",
        rule: "governor",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Governor office for the Mysore region."],
  },
  {
    id: "governor-hyderabad",
    label: "Governor of Hyderabad",
    category: "governor",
    presidency: "madras",
    region: "hyderabad",
    hiring: {
      hirer: {
        type: "office",
        officeId: "president-madras",
      },
      candidatePool: {
        type: "special",
        rule: "governor",
      },
      excludeHirerUntilNepotismConsent: true,
    },
    source: "John-Company-Rules.txt",
    notes: ["Governor office for the Hyderabad region."],
  },
];
