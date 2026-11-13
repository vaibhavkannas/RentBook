# RentBook user guide

RentBook records the rent you receive for each part of your building in your own Google Sheet, from your phone. This guide is for the owner and for the people the owner added. If something goes wrong, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Names in bold are the words on the screen.

## Signing in

Open the app's address and tap **Sign in with Google**. Use the Google account the owner added. The first account on the owner's list is the owner; everyone else is a member. Members can log, change and undo payments, change tenant details and read every report. Only the owner can change **Portion settings** and open **Set up** and **Diagnostics**. A sign-in lasts seven days. **Sign out** is under **More**.

## The month screen

The title is the month on show. Tap the arrows or swipe to change month, or tap the title to pick one. **Today** comes back to this month. The bar at the bottom switches between **Month**, **Activity** and **More**. Above the portions, a summary card shows a ring and the amount received against what is due; a vacant portion adds nothing to what is due. Under it, **All**, **Unpaid**, **Paid** and **Vacant** narrow the list. Each portion is one line: a round mark, its name, who pays, the amount and a pill: **Paid**, **Pending**, **Overdue** or **Vacant**. **Overdue** is a card with no payment whose rent has counted as overdue (from the 6th, see below), shown in red; **Pending** is one not yet overdue, and the **Unpaid** chip lists both. Tap a line to open it: its facts, any notes and its buttons. A paid card also says when the amount was more or less than the usual rent. A change shows on the card at once and is confirmed with Google in the background; if Google fails, the card goes back and a message offers **Try again**. The screen refreshes itself when you return to the app after a minute or more, and says how old its figures are (**Updated just now**).

**Needs attention** appears on this month only, when something is due: rent overdue, agreements that have ended or end within 60 days, and rent going up soon. Tap a row to see why. **Year at a glance** is a link under the summary. The Back button and the arrows on the other screens return to the month you were looking at. Under **More**, **Appearance** sets the colours: **Auto** follows your phone, **Light** and **Dark** override it, and the choice is remembered on this phone.

## Logging a payment

Tap **Log payment** on a **Pending** or **Overdue** card. The amount starts as the usual rent, the count is set for you, and **Date received** starts as today. Change them if you need to, then tap **Save to Sheet**. The payment goes into your Schedule, and a line with who logged it goes into the Payments Log tab.

The first payment of a new cycle starts with the portion's hike. Tap **Round to** or **Keep** if you agreed something else.

The rent RentBook suggests is the first payment of the current hike cycle. A different amount in another month is treated as agreed for that month: it does not change the suggestion and is never overdue. After a hike, the first payment you log is taken as the new rent, rounded or not. A mistake in it lasts the whole cycle, so RentBook asks you to confirm one far from the suggestion. If the rent changes for good mid-cycle, the old rent is still suggested, each month shows a difference, Overdue counts unpaid months at the old rent and the next hike is worked from it, until the next cycle. Where the count never resets, the suggestion follows the last payment.

If the month already has a payment (someone logged it a moment ago), RentBook says so and offers **Replace amount** or **Go back**. To change a payment, tap **Edit amount** on a **Paid** card. To take one back, tap **Undo** and confirm with **Undo payment**. The Schedule is cleared, and the Payments Log keeps a record. A payment cannot be undone while later months have payments.

**New tenant**, under the cards (or **Add tenant** on a vacant card), starts a new tenant at payment 1 together with their first payment. Choose the portion, type the name and the amount. **Tenancy details (optional)** can hold the move-in date, advance, agreement end and phone.

## Tenant details and moving out

On each card, **Details** (or **Add details**, when none are saved) opens the tenant page: phone, move-in date, agreement end, advance and notes. **Edit** changes them and **Save details** saves them. **Move out** records the day the tenant left and what happened to the advance; tap **Record move-out** to save. From the month after the move-out (or that month, if the tenant left on the 1st) the portion shows **Vacant**, and stays so until you add someone with **New tenant**. Past tenants are listed under the details.

**History** lists every change made in the app to a tenant's details, newest first, with who made it and when. A phone number or a note is only said to have changed. Changes typed straight into the Sheet are not listed.

## Activity

**Activity** lists each payment that was logged, changed or undone, in one card for each day it was saved (India time), newest first, each entry with a mark for its kind, who did it and the day the money was received. **All**, **Logged**, **Changed** and **Undone** narrow it by kind, and a second row narrows it to one portion. It shows the newest 50 that match. When nothing matches, **Show everything** clears the choices.

## Overdue rent, Year at a glance, and Agreements and hikes

These three are under **More**, and only read your Sheet. Each opens with a summary card at the top.

**Overdue rent** lists who owes what, the most owed first, with each month behind it as a red chip you tap to open that month. Rent is due on the 1st and counts as overdue from the 6th, five days later. Only the current tenant counts. A month is overdue only when no payment is recorded for it, and it then owes the usual rent. A month with any payment recorded is never overdue, even if the amount is not the usual rent, for example an amount you agreed with the tenant. Vacant months, months paid ahead and the advance are never counted. A tenant who has left keeps showing until you record the move-out.

**Year at a glance** shows each portion's twelve months of a year as a grid, with what was received against what was due. A key under the summary says what each mark means (**Paid**, **Unpaid**, **Vacant**, **Not due yet**); a month with a payment recorded is **Paid** whatever the amount. Tap a month to open it.

**Agreements and hikes** lists agreements that have ended or end within 60 days, and rent increases coming within the next 2 months. A hike comes with the first payment of a new cycle, so the screen works it out from the count, the portion's cycle length and the rent of the cycle (its first payment). It lists none for a portion whose count never resets, whose hike is 0%, or that is vacant. The app sends no reminders: look here.

## Portion settings

For the owner: **More**, then **Portion settings**. For each portion, set **Payments per cycle** (after that many payments the count starts again at 1 and the hike is added) or tick **Count never resets**, set **Hike at each new cycle (%)**, and tap **Save settings**. Do this before the first payment: the app cannot change a payment count later.

**Add a portion** adds one, with its name, cycle and hike. **Switch off** takes a portion off the month screen when it is no longer rented out; its payments and tenants stay, and it can be switched on again. **Change order** sets the order of the cards.

## Set up and Diagnostics

For the owner. **Set up** checks each part of the connection to your Sheet and says what to do about anything that is wrong. **Prepare my Sheet** makes the tabs the app needs when they are missing. **Check again** runs the checks again. **Diagnostics** shows the version, whether the Sheet answers and how fast, and what each tab holds. Neither shows a secret or a tenant's details.

## Adding the app to the home screen

On Android, open the browser menu and choose Install app or Add to Home screen. On an iPhone, open the Share menu in Safari and choose Add to Home Screen. The app then opens full screen. In the installed Android app, Back on the month screen shows "Press back again to exit" before it leaves.
