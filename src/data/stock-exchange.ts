import type { StockExchangeTrackDefinition } from "./types";

export const stockExchangeTrack: StockExchangeTrackDefinition = {
  id: "standard-stock-exchange",
  source: "board_image-1.png",
  slots: [
    {
      id: "stock-exchange-2",
      cost: 2,
      rightwardOrder: 1,
      boardPosition: { x: 876, y: 1573 },
      source: "board_image-1.png",
    },
    {
      id: "stock-exchange-3-left",
      cost: 3,
      rightwardOrder: 2,
      boardPosition: { x: 961, y: 1430 },
      source: "board_image-1.png",
    },
    {
      id: "stock-exchange-3-right",
      cost: 3,
      rightwardOrder: 3,
      boardPosition: { x: 1046, y: 1573 },
      source: "board_image-1.png",
    },
    {
      id: "stock-exchange-4",
      cost: 4,
      rightwardOrder: 4,
      boardPosition: { x: 1131, y: 1430 },
      source: "board_image-1.png",
    },
    {
      id: "stock-exchange-5",
      cost: 5,
      rightwardOrder: 5,
      boardPosition: { x: 1217, y: 1573 },
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
