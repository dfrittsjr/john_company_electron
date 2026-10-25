---
layout: ../layouts/SiteLayout.astro
title: How to play
---

# How to play

This site runs the game in your browser. Nothing is stored on a server: the whole game lives in a
save file (`.joco`) that you pass between players.

## Starting a game

1. Open [Play](/play/) and choose **New Game**.
2. Pick the scenario and enter everyone's names in seating order.
3. Take any decisions that are yours, then use **Save & pass**.

## Taking your turn

1. Download the latest `.joco` file someone sent you (Discord, email, whatever your group uses).
2. Open [Play](/play/), choose **Load Save**, and pick that file.
3. The panel on the left shows whose decision is pending. Make every decision that is yours.
4. When the game is waiting on someone else, choose **Save & pass**. The file is named after the
   player who acts next, for example `1710-t2-hiring-for-Yellow.joco`.
5. Send that file to them.

Chrome and Edge ask where to save. Firefox and Safari put the file in your downloads folder.

## Playing online

Instead of passing a file, you can play at a shared table where a server holds the game.

1. Open [Play online](/online/), choose **Start an online game**, and enter the players' names.
2. You get one private link per player and a spectator link. Send each friend their own link. A
   seat link works like a password: anyone who has it can play that seat.
3. Open your link. The page keeps the key in this browser, so next time you can return from the
   "Your games in this browser" list on the same page and see which games are waiting for you.
4. Make your decisions when it is your turn. When it is someone else's, the page says who it is
   waiting for. Updates appear on their own, and the tab title shows "(Your turn)" when it is yours.
   Press **Notify me** if you also want a desktop notification while the tab is in the background.
5. **Undo** takes back your own last move, as long as nobody has acted since and no dice or cards
   were involved. **Export .joco** downloads a save you can continue offline.

You can also move a game you are already playing onto an online table with **Import a .joco save**.

## Tips

- Always load the newest file. If two people play from the same file, the game forks; agree on
  which branch to keep.
- **Copy Save Summary** puts a short "whose turn, which phase" note on your clipboard to paste
  alongside the file.
- Reloading or closing the tab discards anything you have not saved.
- A table playing on one computer can simply keep going without saving between players.

## Rules

This site enforces the rules as they are implemented so far, but it is not a substitute for the
rulebook. Use the rulebook from the official print-and-play kit for anything the game does not
explain yet.

The rulebook's text is also on the [Rules](/rules/) page, and during a game the **Rules** button
opens it in a panel. The decision panel's **Rules for this phase** link jumps to the current phase.
