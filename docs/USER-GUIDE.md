# RentBook user guide

RentBook records the rent you receive for each part of your building in your own Google Sheet, from your phone. This guide is for the owner and for the people the owner added. If something goes wrong, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Names in bold are the words on the screen.

## Signing in

Open the app's address and tap **Sign in with Google**. Use the Google account the owner added. The first account on the owner's list is the owner; everyone else is a member. Members can log, change and undo payments, change tenant details and read every report. Only the owner can change **Portion settings** and open **Set up** and **Diagnostics**. A sign-in lasts seven days. **Sign out** is under **More**.

## The month screen

The title is the month on show. Tap the arrows or swipe to change month, or tap the title to pick one. **Today** comes back to this month. Each portion has a card with a pill: **Paid**, **Pending** or **Vacant**. A paid card also says when the amount was more or less than the usual rent. Above the cards, the summary shows what was received against what is due; a vacant portion adds nothing to what is due.

**Needs attention** appears on this month only, when something is due: rent overdue, agreements that have ended or end within 60 days, and rent going up soon. Tap a row to see why. **Year at a glance** is a link under the summary. The Back button and the arrows on the other screens return to the month you were looking at.

## Logging a payment

Tap **Log payment** on a **Pending** card. The amount starts as the usual rent, the count is set for you, and **Date received** starts as today. Change them if you need to, then tap **Save to Sheet**. The payment goes into your Schedule, and a line with who logged it goes into the Payments Log tab.

The first payment of a new cycle carries the portion's hike, and the amount starts with it. Tap **Round to** a round figure, or **Keep** the old rent, if you agreed something else. A rent within ₹ 10 of the hike counts as rounded, not as extra or short.

If the month already has a payment (someone logged it a moment ago), RentBook says so and offers **Replace amount** or **Go back**. To change a payment, tap **Edit amount** on a **Paid** card. To take one back, tap **Undo** and confirm with **Undo payment**. The Schedule is cleared, and the Payments Log keeps a record. A payment cannot be undone while later months have payments.

**New tenant**, under the cards (or **Add tenant** on a vacant card), starts a new tenant at payment 1 together with their first payment. Choose the portion, type the name and the amount. **Tenancy details (optional)** can hold the move-in date, advance, agreement end and phone.

## Tenant details and moving out

On each card, **Details** (or **Add details**, when none are saved) opens the tenant page: phone, move-in date, agreement end, advance and notes. **Edit** changes them and **Save details** saves them. **Move out** records the day the tenant left and what happened to the advance; tap **Record move-out** to save. From the month after the move-out (or that month, if the tenant left on the 1st) the portion shows **Vacant**, and stays so until you add someone with **New tenant**. Past tenants are listed under the details.

**History** lists every change made in the app to a tenant's details, newest first, with who made it and when. A phone number or a note is only said to have changed. Changes typed straight into the Sheet are not listed.

## Activity

**Activity** lists each payment that was logged, changed or undone, under the day it was saved (India time), newest first, with who did it and the day the money was received. **All**, **Logged**, **Changed** and **Undone** narrow it by kind, and a second row narrows it to one portion. It shows the newest 50 that match. When nothing matches, **Show everything** clears the choices.

## Overdue rent, Year at a glance, and Agreements and hikes

These three are under **More**, and only read your Sheet.

**Overdue rent** lists who owes what, the most owed first, with the months behind each amount; tap a month to open it. Rent is due on the 1st and counts as overdue from the 6th, five days later. Only the current tenant counts. A month is overdue only when no payment is recorded for it, and it then owes the usual rent. A month with any payment recorded is never overdue, even if the amount is not the usual rent, for example an amount you agreed with the tenant. Vacant months, months paid ahead and the advance are never counted. A tenant who has left keeps showing until you record the move-out.

**Year at a glance** shows each portion's twelve months of a year as a grid, with what was received against what was due. A key under the summary says what each mark means (**Paid**, **Unpaid**, **Vacant**, **Not due yet**); a month with a payment recorded is **Paid** whatever the amount. Tap a month to open it.

**Agreements and hikes** lists agreements that have ended or end within 60 days, and rent increases coming within the next 2 months. A hike comes with the first payment of a new cycle, so the screen works it out from the count and the portion's cycle length. It lists none for a portion whose count never resets, whose hike is 0%, or that is vacant. The app sends no reminders: look here.

## Portion settings

For the owner: **More**, then **Portion settings**. For each portion, set **Payments per cycle** (after that many payments the count starts again at 1 and the hike is added) or tick **Count never resets**, set **Hike at each new cycle (%)**, and tap **Save settings**. Do this before the first payment: the app cannot change a payment count later.

**Add a portion** adds one, with its name, cycle and hike. **Switch off** takes a portion off the month screen when it is no longer rented out; its payments and tenants stay, and it can be switched on again. **Change order** sets the order of the cards.

## Set up and Diagnostics

For the owner. **Set up** checks each part of the connection to your Sheet and says what to do about anything that is wrong. **Prepare my Sheet** makes the tabs the app needs when they are missing. **Check again** runs the checks again. **Diagnostics** shows the version, whether the Sheet answers and how fast, and what each tab holds. Neither shows a secret or a tenant's details.

## Adding the app to the home screen

On Android, open the browser menu and choose Install app or Add to Home screen. On an iPhone, open the Share menu in Safari and choose Add to Home Screen. The app then opens full screen. In the installed Android app, Back on the month screen shows "Press back again to exit" before it leaves.
