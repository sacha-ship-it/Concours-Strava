'use strict';

function modal(contestId, today) {
  const label = (text, component) => ({
    type: 18,
    label: text,
    component
  });

  const text = (
    id,
    placeholder,
    max,
    value
  ) => ({
    type: 4,
    custom_id: id,
    style: 1,
    required: true,
    max_length: max,
    placeholder,
    ...(value ? { value } : {})
  });

  return {
    custom_id: `activityform:${contestId}`,
    title: 'Ajouter mon activité Strava',

    components: [
      label(
        'Sport pratiqué',
        {
          type: 3,
          custom_id: 'sport',
          placeholder: 'Choisis ton sport',
          min_values: 1,
          max_values: 1,

          options: [
            {
              label: 'Course à pied',
              value: 'run',
              emoji: { name: '🏃' }
            },
            {
              label: 'Vélo sans assistance',
              value: 'bike',
              emoji: { name: '🚴' }
            },
            {
              label: 'Natation',
              value: 'swim',
              emoji: { name: '🏊' }
            },
            {
              label: 'Musculation',
              value: 'strength',
              emoji: { name: '🏋️' }
            },
            {
              label: 'Football',
              value: 'football',
              emoji: { name: '⚽' }
            }
          ]
        }
      ),

      label(
        'Date de l’activité',
        text(
          'day',
          'JJ/MM/AAAA ou AAAA-MM-JJ',
          10,
          today
        )
      ),

      label(
        'Distance (km) ou musculation (minutes)',
        text(
          'quantity',
          'Exemple : 5,2 km → écris 5,2 ; 45 min → 45',
          12
        )
      ),

      label(
        'Lien complet de l’activité Strava',
        text(
          'link',
          'https://www.strava.com/activities/123456789',
          300
        )
      ),

      label(
        'Capture : nom, date, sport et résultat',
        {
          type: 19,
          custom_id: 'proof',
          min_values: 1,
          max_values: 1,
          required: true
        }
      )
    ]
  };
}

function parseDay(value) {
  const input = value.trim();

  const match = input.match(
    /^(\d{2})\/(\d{2})\/(\d{4})$/
  );

  return match
    ? `${match[3]}-${match[2]}-${match[1]}`
    : input;
}

function parseQuantity(value) {
  const input = value.trim()
    .replace(',', '.');

  if (
    !/^\d+(\.\d+)?$/.test(input)
  ) {
    throw Error(
      'Écris uniquement le nombre : ' +
      '5,2 pour 5,2 km ou 45 pour 45 minutes.'
    );
  }

  const quantity = Number(input);

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    throw Error(
      'La quantité doit être supérieure à zéro.'
    );
  }

  return quantity;
}

function imageURL(value) {
  if (value === 'aucune') {
    return null;
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw Error(
      'Image : utilise une URL HTTPS ' +
      'ou écris aucune pour la retirer.'
    );
  }

  if (url.protocol !== 'https:') {
    throw Error(
      'L’image doit utiliser HTTPS.'
    );
  }

  return url.href;
}

module.exports = {
  modal,
  parseDay,
  parseQuantity,
  imageURL
};
