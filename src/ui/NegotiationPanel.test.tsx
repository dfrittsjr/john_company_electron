import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BLUE, RED, negotiationGame, withBlackmail } from "../tests/fixtures/negotiation";
import { NegotiationPanel } from "./NegotiationPanel";

afterEach(cleanup);

const game = withBlackmail(negotiationGame("londonSeason", { [RED]: 5 }), RED, "the-prime-ministers-ear", { instanceId: "ear" });

describe("NegotiationPanel", () => {
  test("hides face-down blackmail until the player confirms they hold the device", () => {
    const onReveal = vi.fn();
    render(<NegotiationPanel game={game} revealedPlayer={null} onReveal={onReveal} onCommand={vi.fn()} />);

    expect(screen.queryByText(/Prime Minister's Ear/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I am Red: reveal" }));
    expect(onReveal).toHaveBeenCalledWith(RED);
  });

  test("shows the revealed player's own blackmail and plays it through an anytime command", () => {
    const onCommand = vi.fn();
    render(<NegotiationPanel game={game} revealedPlayer={RED} onReveal={vi.fn()} onCommand={onCommand} />);

    expect(screen.getByText("The Prime Minister's Ear")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Swap social and companyShare" }));
    expect(onCommand).toHaveBeenCalledWith(RED, "negotiation.playBlackmail", {
      cardInstanceId: "ear",
      params: { markers: ["social", "companyShare"] },
    });
  });

  test("another player sees only a face-down card when asking for it in a deal", () => {
    const { container, rerender } = render(
      <NegotiationPanel game={game} revealedPlayer={null} onReveal={vi.fn()} onCommand={vi.fn()} />,
    );
    fireEvent.change(container.querySelector("select")!, { target: { value: BLUE } });
    rerender(<NegotiationPanel game={game} revealedPlayer={BLUE} onReveal={vi.fn()} onCommand={vi.fn()} />);

    expect(screen.getByText("Deals & Cards: Blue")).toBeTruthy();
    expect(screen.getByText(/Face-down blackmail 1/)).toBeTruthy();
    expect(screen.queryByText(/Prime Minister's Ear/)).toBeNull();
  });

  test("gives cash with the give-now button", () => {
    const onCommand = vi.fn();
    const { container } = render(
      <NegotiationPanel game={game} revealedPlayer={RED} onReveal={vi.fn()} onCommand={onCommand} />,
    );
    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Give now" }));

    expect(onCommand).toHaveBeenCalledWith(RED, "negotiation.give", {
      to: BLUE,
      items: [{ kind: "cash", amount: 3 }],
    });
  });
});
