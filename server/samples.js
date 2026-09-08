/**
 * Demo source stories. Each is realistic wire copy.
 *
 * The first carries an `update` — a revised body in which a developing number
 * and one attribution change. Loading it gives a judge a one-click way to see
 * the stale-detection loop fire on real edits, without typing a story.
 */
export const SAMPLES = [
  {
    id: 'noida',
    name: 'Noida stairwell collapse',
    tag: 'Best for the stale-detection demo',
    headline: 'Five dead as stairwell collapses at Noida industrial unit',
    body: `NOIDA: Five people were killed and 12 injured when an external stairwell at a garment unit in Sector 62, Noida collapsed early on Tuesday, police said.

The structure gave way at about 6.15 am as the night shift was leaving the building, according to a Delhi Police spokesperson. Twelve of those hurt were taken to Fortis Hospital, Noida, where four are described as critical.

The National Disaster Response Force said its teams cleared the debris by 4.30 am on Wednesday. Around 1,200 residents of adjoining blocks were moved to a municipal school as a precaution.

The unit had been served a structural safety notice in March, an official of the Noida Authority said. The building's owner has not been reached for comment.

A magisterial inquiry has been ordered. Police said no arrests have been made so far.`,
    updates: [
      {
      label: 'Big update — toll rises to 8, arrests made',
      note: 'Changes a fact almost every format carries.',
      headline: 'Eight dead as stairwell collapses at Noida industrial unit',
      body: `NOIDA: Eight people were killed and 12 injured when an external stairwell at a garment unit in Sector 62, Noida collapsed early on Tuesday, police said.

The structure gave way at about 6.15 am as the night shift was leaving the building, according to the Noida Police Commissioner. Twelve of those hurt were taken to Fortis Hospital, Noida, where four are described as critical.

The National Disaster Response Force said its teams cleared the debris by 4.30 am on Wednesday. Around 1,200 residents of adjoining blocks were moved to a municipal school as a precaution.

The unit had been served a structural safety notice in March, an official of the Noida Authority said. The building's owner has not been reached for comment.

A magisterial inquiry has been ordered. Police said two people have been arrested.`,
      },
      {
        label: 'Small correction — wrong hospital named',
        note: 'Touches only the formats that named the hospital.',
        headline: 'Five dead as stairwell collapses at Noida industrial unit',
        body: `NOIDA: Five people were killed and 12 injured when an external stairwell at a garment unit in Sector 62, Noida collapsed early on Tuesday, police said.

The structure gave way at about 6.15 am as the night shift was leaving the building, according to a Delhi Police spokesperson. Twelve of those hurt were taken to Kailash Hospital, Noida, where four are described as critical.

The National Disaster Response Force said its teams cleared the debris by 4.30 am on Wednesday. Around 1,200 residents of adjoining blocks were moved to a municipal school as a precaution.

The unit had been served a structural safety notice in March, an official of the Noida Authority said. The building's owner has not been reached for comment.

A magisterial inquiry has been ordered. Police said no arrests have been made so far.`,
      },
    ],
  },
  {
    id: 'rbi',
    name: 'RBI holds repo rate',
    tag: 'Numbers-heavy · good infographic',
    headline: 'RBI holds repo rate at 6.5%, trims growth forecast to 6.8%',
    body: `MUMBAI: The Reserve Bank of India kept its policy repo rate unchanged at 6.5 per cent on Friday, the eleventh consecutive review at which the rate has been held.

The Monetary Policy Committee voted 4-2 in favour of the pause, Governor Sanjay Malhotra said at the post-policy briefing in Mumbai. The committee retained its neutral stance.

The central bank lowered its GDP growth projection for the current financial year to 6.8 per cent from 7.2 per cent, citing weaker urban demand. Retail inflation was projected at 4.8 per cent for the year.

The standing deposit facility rate stays at 6.25 per cent and the marginal standing facility rate at 6.75 per cent.

The Governor said the committee would remain watchful of food price pressures. The next review is scheduled for February.`,
  },
  {
    id: 'metro',
    name: 'Delhi Metro Phase 4 opening',
    tag: 'Civic · sequential photostory',
    headline: 'Delhi Metro opens 12.9-km Phase 4 stretch between Janakpuri West and Krishna Park',
    body: `NEW DELHI: The Delhi Metro Rail Corporation opened a 12.9-km section of the Magenta Line between Janakpuri West and Krishna Park Extension on Sunday, adding eight stations to the network.

The stretch was inaugurated by the Union Housing and Urban Affairs Minister at a function at Janakpuri West station. Services began for the public at 3 pm.

DMRC said the section is expected to serve about 85,000 commuters a day and cuts the journey between Janakpuri and Krishna Park to 21 minutes from roughly 55 minutes by road.

Six of the eight stations are underground. The corporation said the remaining 16.4 km of the Phase 4 corridor would be commissioned by December.

A DMRC spokesperson said fares on the new section would follow the existing distance-based slab, with a maximum fare of Rs 60.`,
  },
];
