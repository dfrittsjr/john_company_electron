import type { StockExchangeTrackDefinition } from "./types";

export const stockExchangeTrack: StockExchangeTrackDefinition = {
  id: "standard-stock-exchange",
  source: "board_image-1.png",
  slots: [
    {
      id: "stock-exchange-2",
      cost: 2,
      rightwardOrder: 1,
      boardPosition: { x: 877, y: 1653 },
      source: "board_image-1.png",
    },
    {
      id: "stock-exchange-3-left",
      cost: 3,
      rightwardOrder: 2,
      boardPosition: { x: 973, y: 1533 },
      source: "board_image-1.png",
    },
    {
      id: "stock-exchange-3-right",
      cost: 3,
      rightwardOrder: 3,
      boardPosition: { x: 1054, y: 1648 },
      source: "board_image-1.png",
    },
    {
      id: "stock-exchange-4",
      cost: 4,
      rightwardOrder: 4,
      boardPosition: { x: 1142, y: 1533 },
      source: "board_image-1.png",
    },
    {
      id: "stock-exchange-5",
      cost: 5,
      rightwardOrder: 5,
      boardPosition: { x: 1259, y: 1648 },
      source: "board_image-1.png",
    },
  ],
  shareCreation: {
    debtReductionPerCreatedShare: 1,
    createdFrom: "rightmost",
    slideRemainingPieces: "rightwardPreservingOrder",
    source: "John-Company-Rules.txt",
  },
};
