'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  randomUUID,
  createHash
} = require('node:crypto');

const sharp = require('sharp');

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require('discord.js');

const {
  openStore,
  SPORTS,
  date,
  activityId
} = require('./store');

const UI = require('./ui');
const env = process.env;

for (const key of [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'ADMIN_ROLE_ID',
  'DATA_DIR'
]) {
  if (!env[key]) {
    throw Error(
      'Variable manquante : ' + key
    );
  }
}

const root = path.resolve(
  env.DATA_DIR
);

fs.mkdirSync(
  path.join(root, 'proofs'),
  { recursive: true }
);

const S = openStore(
  path.join(root, 'sport.sqlite')
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

const E = MessageFlags.Ephemeral;
const V = PermissionFlagsBits;

const color =
  env.BOT_COLOR || '#18263A';

if (
  !/^#[0-9a-f]{6}$/i.test(color)
) {
  throw Error(
    'BOT_COLOR doit être #RRGGBB.'
  );
}

const staff = i =>
  i.memberPermissions?.has(
    V.Administrator
  ) ||
  i.member?.roles?.cache?.has(
    env.ADMIN_ROLE_ID
  );

const row = (...components) =>
  new ActionRowBuilder()
    .addComponents(components);

const btn = (
  id,
  label,
  style = ButtonStyle.Secondary
) =>
  new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style);

const embed = (title, text) =>
  new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(text)
    .setFooter({
      text:
        'NUTRIMUSCLE • SPORT CHALLENGE'
    });

const n = value =>
  Number(value).toLocaleString(
    'fr-FR',
    {
      maximumFractionDigits: 2
    }
  );

function requireContest(id) {
  const c = id
    ? S.contest(id)
    : S.active();

  if (!c) {
    throw Error(
      'Aucun concours configuré.'
    );
  }

  return c;
}

function entry(id) {
  const e = S.get(id);

  if (!e) {
    throw Error(
      'Activité introuvable.'
    );
  }

  return e;
}

const all = (sql, ...params) =>
  S.db.prepare(sql).all(
    ...params
  );

function rules(c) {
  return (
    `🏃 Course : **${n(c.rates.run)} pts/km**\n` +
    `🚴 Vélo sans assistance : **${n(c.rates.bike)} pts/km**\n` +
    `🏊 Natation : **${n(c.rates.swim)} pts/km**\n` +
    `🏋️ Musculation : **${n(c.rates.strength)} pts/min**, ` +
    `maximum **${n(c.strengthCap)} pts/jour**\n` +
    `⚽ Football : **${n(c.rates.football)} pts/km enregistré**\n\n` +
    'Barème propre au concours, pas une équivalence physiologique. ' +
    'Pas de vélo électrique, de distances estimées ni de double ' +
    'enregistrement d’une même séance. ' +
    'Activités saisies manuellement refusées.'
  );
}

function panel(c) {
  const intro = c.text ?? (
    '**Chaque séance compte. À toi de jouer.**\n\n' +
    'Course, vélo, natation, musculation ou football : ' +
    'cumule des points avec tes activités et retrouve ' +
    'ta place dans un classement commun.\n\n' +
    '**Comment participer ?**\n' +
    '1️⃣ Clique sur **Ajouter mon activité Strava**.\n' +
    '2️⃣ Choisis ton sport, renseigne la date, ton résultat ' +
    'et le lien Strava, puis joins ta capture.\n' +
    '3️⃣ Le staff vérifie ta preuve : ' +
    'tes points s’ajoutent après validation.\n\n' +
    '🏆 Retrouve ton rang avec **Mon classement** ' +
    'et suis tes demandes dans **Mes activités**.'
  );

  const e = embed(
    c.title,
    `${intro}

📅 **Activités du ${c.start} au ${c.end} inclus**
⏳ **Fin des dépôts :** <t:${Math.floor(c.deadline / 1000)}:F>

Ta preuve doit montrer le nom Strava, la date, le sport et la distance ou durée. Tu peux masquer ton parcours et ton adresse. Preuves privées au staff ; pseudo Discord et score publics. En envoyant ta demande, tu acceptes cette vérification et l’affichage de ton score. Consulte **Barème** et l’annonce pour les lots et les règles du concours.`
  );

  if (c.image) {
    e.setImage(c.image);
  }

  return e;
}

function panelButtons(c) {
  return [
    row(
      btn(
        `add:${c.id}`,
        '➕ Ajouter mon activité Strava',
        ButtonStyle.Primary
      ),
      btn(
        `mine:${c.id}:0`,
        '📋 Mes activités'
      ),
      btn(
        `rank:${c.id}`,
        '🏆 Mon classement'
      ),
      btn(
        `help:${c.id}`,
        'ℹ️ Barème'
      )
    )
  ];
}

function leaderboard(c, page = 0) {
  const list =
    S.ranking(c.id);

  const pages = Math.max(
    1,
    Math.ceil(
      list.length / 10
    )
  );

  page = Math.max(
    0,
    Math.min(
      page,
      pages - 1
    )
  );

  const intro = c.boardText
    ? c.boardText + '\n\n'
    : '';

  const rows = list.length
    ? list.slice(
        page * 10,
        page * 10 + 10
      ).map(e =>
        `**${e.rank}.** <@${e.user}> · ` +
        `**${n(e.points)} pts** · ` +
        `${e.activities} activité(s)`
      ).join('\n')
    : 'Aucune activité validée pour le moment.';

  return {
    embeds: [
      embed(
        c.title,
        `**${c.final
          ? 'Classement final'
          : 'Classement provisoire'
        } · Points validés**

${intro}${rows}

**${list.length} participant(s)** · Page ${page + 1}/${pages}
Les égalités de points partagent le même rang.
Mise à jour <t:${Math.floor(Date.now() / 1000)}:R>`
      )
    ],

    components: [
      row(
        btn(
          `board:${c.id}:${Math.max(0, page - 1)}`,
          '←'
        ),
        btn(
          `rank:${c.id}`,
          'Mon classement'
        ),
        btn(
          `board:${c.id}:${page + 1}`,
          '→'
        )
      )
    ],

    allowedMentions: {
      parse: []
    }
  };
}

let refreshing = false;
let dirty = false;

async function refresh() {
  dirty = true;

  if (refreshing) {
    return;
  }

  refreshing = true;

  try {
    while (dirty) {
      dirty = false;

      const c = S.active();

      if (!c) continue;

      try {
        const channel =
          await client.channels.fetch(
            c.boardChannel
          );

        if (c.boardMessage) {
          await channel.messages.edit(
            c.boardMessage,
            leaderboard(c)
          );
        }
      } catch (error) {
        console.error(
          'Classement non actualisé :',
          error.message
        );
      }
    }
  } finally {
    refreshing = false;
  }
}

function staffCard(e) {
  const c = requireContest(
    e.contest
  );

  const unit = e.sport === 'strength'
    ? 'min'
    : 'km';

  const ticket = e.ticket
    ? `**Discussion :** <#${e.ticket}>`
    : '';

  return {
    embeds: [
      embed(
        `Activité ${e.id}`,
        `**Membre :** <@${e.user}>
**Sport :** ${SPORTS[e.sport]}
**Date :** ${e.day}
**${e.sport === 'strength' ? 'Durée' : 'Distance'} :** ${n(e.quantity)} ${unit}
**Points avant plafond :** ${n(S.score(c, e))}
**Statut :** ${e.status}
**Points attribués :** ${n(e.points)}
**Décision :** ${e.reason || '—'}
**Lien :** https://www.strava.com/activities/${e.activity}
${ticket}`
      ).setImage(
        'attachment://proof.jpg'
      )
    ],

    components: [
      row(
        btn(
          `approve:${e.id}`,
          'Valider',
          ButtonStyle.Success
        ).setDisabled(
          e.status !== 'pending'
        ),
        btn(
          `reject:${e.id}`,
          'Refuser',
          ButtonStyle.Danger
        ).setDisabled(
          e.status !== 'pending'
        ),
        btn(
          `talk:${e.id}`,
          'Demander une précision'
        )
      )
    ],

    allowedMentions: {
      parse: []
    }
  };
}

async function sendStaff(id) {
  const e = entry(id);

  const c = requireContest(
    e.contest
  );

  const channel =
    await client.channels.fetch(
      c.staffChannel
    );

  const body = {
    ...staffCard(e),

    files: [
      new AttachmentBuilder(
        path.join(
          root,
          e.proof
        ),
        {
          name: 'proof.jpg'
        }
      )
    ]
  };

  if (e.staff_message) {
    try {
      await channel.messages.edit(
        e.staff_message,
        {
          ...body,
          attachments: []
        }
      );

      return;
    } catch (error) {
      if (
        error.code !== 10008
      ) {
        throw error;
      }
    }
  }

  const message =
    await channel.send(body);

  S.db.prepare(`
    UPDATE entries
    SET staff_message=?
    WHERE id=?
  `).run(
    message.id,
    id
  );
}

async function notify(e, text) {
  try {
    const user =
      await client.users.fetch(
        e.user
      );

    await user.send(text);
  } catch {
    console.log(
      'DM fermé :',
      e.user,
      'consulter Mes activités'
    );
  }
}

async function downloadProof(a) {
  if (
    a.size > 8 * 1024 * 1024 ||
    !a.contentType?.startsWith(
      'image/'
    )
  ) {
    throw Error(
      'Capture image uniquement, maximum 8 Mo.'
    );
  }

  const url = new URL(a.url);

  if (![
    'cdn.discordapp.com',
    'media.discordapp.net'
  ].includes(url.hostname)) {
    throw Error(
      'Joins une image dans Discord.'
    );
  }

  const response = await fetch(
    url,
    {
      redirect: 'error',
      signal:
        AbortSignal.timeout(
          15000
        )
    }
  );

  if (!response.ok) {
    throw Error(
      'Impossible de récupérer la capture.'
    );
  }

  let size = 0;
  const chunks = [];

  for await (
    const chunk of response.body
  ) {
    size += chunk.length;

    if (
      size >
      8 * 1024 * 1024
    ) {
      throw Error(
        'Image trop volumineuse.'
      );
    }

    chunks.push(
      Buffer.from(chunk)
    );
  }

  const raw = Buffer.concat(
    chunks
  );

  const hash =
    createHash('sha256')
      .update(raw)
      .digest('hex');

  const image = await sharp(
    raw,
    {
      limitInputPixels:
        24000000
    }
  )
    .rotate()
    .resize({
      width: 1800,
      height: 1800,
      fit: 'inside',
      withoutEnlargement:
        true
    })
    .jpeg({
      quality: 88
    })
    .toBuffer();

  return {
    image,
    hash
  };
}

function ISO(value) {
  if (
    !/(Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  ) {
    throw Error(
      'Date ISO avec décalage obligatoire, ' +
      'ex. 2026-12-02T12:00:00+01:00.'
    );
  }

  const time =
    Date.parse(value);

  if (
    !Number.isFinite(time)
  ) {
    throw Error(
      'Horaire invalide.'
    );
  }

  return time;
}

/* Commandes staff */

const adminCmd =
  new SlashCommandBuilder()
    .setName('concours')
    .setDescription(
      'Gestion du concours sportif'
    )
    .setDefaultMemberPermissions(
      V.ManageGuild
    );

adminCmd.addSubcommand(c =>
  c.setName('creer')
    .setDescription(
      'Créer un concours'
    )
    .addStringOption(o =>
      o.setName('titre')
        .setDescription(
          'Titre public'
        )
        .setMaxLength(150)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('debut')
        .setDescription(
          'Premier jour : AAAA-MM-JJ'
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('fin')
        .setDescription(
          'Dernier jour : AAAA-MM-JJ'
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('limite')
        .setDescription(
          'Fin des dépôts ISO, ex. 2026-12-02T12:00:00+01:00'
        )
        .setRequired(true)
    )
);

adminCmd.addSubcommand(c =>
  c.setName('publier')
    .setDescription(
      'Publier participation et classement'
    )
    .addChannelOption(o =>
      o.setName('participation')
        .setDescription(
          'Salon public du concours'
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('classement')
        .setDescription(
          'Salon du classement'
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('staff')
        .setDescription(
          'Salon privé de vérification'
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('tickets')
        .setDescription(
          'Catégorie dédiée aux tickets privés'
        )
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(true)
    )
);

adminCmd.addSubcommand(c =>
  c.setName('bareme')
    .setDescription(
      'Changer les coefficients AVANT tout dépôt'
    )
    .addNumberOption(o =>
      o.setName('course')
        .setDescription(
          'Points par km'
        )
        .setMinValue(0.01)
    )
    .addNumberOption(o =>
      o.setName('velo')
        .setDescription(
          'Points par km'
        )
        .setMinValue(0.01)
    )
    .addNumberOption(o =>
      o.setName('natation')
        .setDescription(
          'Points par km'
        )
        .setMinValue(0.01)
    )
    .addNumberOption(o =>
      o.setName('muscu')
        .setDescription(
          'Points par minute'
        )
        .setMinValue(0.01)
    )
    .addNumberOption(o =>
      o.setName('foot')
        .setDescription(
          'Points par km'
        )
        .setMinValue(0.01)
    )
    .addNumberOption(o =>
      o.setName('plafond_muscu')
        .setDescription(
          'Points muscu maximum par jour'
        )
        .setMinValue(0.01)
    )
);

for (
  const [name, description]
  of [
    [
      'pause',
      'Fermer les dépôts'
    ],
    [
      'reprendre',
      'Rouvrir les dépôts dans la période'
    ],
    [
      'finaliser',
      'Figer définitivement les résultats'
    ],
    [
      'export',
      'Exporter le classement CSV'
    ],
    [
      'sauvegarde',
      'Télécharger la base complète, privée'
    ],
    [
      'diagnostic',
      'Afficher configuration et demandes'
    ],
    [
      'relancer',
      'Réessayer les envois staff et le classement'
    ]
  ]
) {
  adminCmd.addSubcommand(c =>
    c.setName(name)
      .setDescription(
        description
      )
  );
}

adminCmd.addSubcommand(c =>
  c.setName('retirer')
    .setDescription(
      'Retirer une activité validée'
    )
    .addStringOption(o =>
      o.setName('id')
        .setDescription(
          'ID de l’activité'
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('motif')
        .setDescription(
          'Motif envoyé au membre'
        )
        .setMaxLength(500)
        .setRequired(true)
    )
);

adminCmd.addSubcommand(c =>
  c.setName('corriger')
    .setDescription(
      'Corriger une demande et la remettre en attente'
    )
    .addStringOption(o =>
      o.setName('id')
        .setDescription(
          'ID de la demande'
        )
        .setRequired(true)
    )
    .addNumberOption(o =>
      o.setName('quantite')
        .setDescription(
          'Nouvelle distance km ou durée minutes'
        )
        .setMinValue(0.01)
        .setMaxValue(10000)
        .setRequired(true)
    )
);

adminCmd.addSubcommand(c =>
  c.setName('clore-ticket')
    .setDescription(
      'Fermer un ticket du bot'
    )
    .addStringOption(o =>
      o.setName('id')
        .setDescription(
          'ID de l’activité'
        )
        .setRequired(true)
    )
);

adminCmd.addSubcommand(c =>
  c.setName('presentation')
    .setDescription(
      'Modifier le titre, le texte, l’image et l’intro classement'
    )
    .addStringOption(o =>
      o.setName('titre')
        .setDescription(
          'Titre du concours'
        )
        .setMaxLength(150)
    )
    .addStringOption(o =>
      o.setName('texte')
        .setDescription(
          'Texte libre, Markdown accepté ; defaut pour rétablir'
        )
        .setMaxLength(2400)
    )
    .addStringOption(o =>
      o.setName('image')
        .setDescription(
          'URL HTTPS de l’image ; aucune pour la retirer'
        )
        .setMaxLength(1000)
    )
    .addStringOption(o =>
      o.setName('texte_classement')
        .setDescription(
          'Introduction du classement ; aucune pour la retirer'
        )
        .setMaxLength(500)
    )
);

adminCmd.addSubcommand(c =>
  c.setName('annoncer')
    .setDescription(
      'Envoyer le panneau dans un salon, notification facultative'
    )
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription(
          'Salon où envoyer le panneau'
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('notification')
        .setDescription(
          'Rôle à notifier, facultatif'
        )
    )
);

/* Dépôt d’activité */

async function submitActivity(
  i,
  c,
  input
) {
  if (!c.staffChannel) {
    throw Error(
      'Le staff doit publier le concours avant les dépôts.'
    );
  }

  const id =
    randomUUID()
      .slice(0, 12);

  const sport =
    input.sport;

  const day = date(
    UI.parseDay(
      input.day
    )
  );

  const quantity =
    UI.parseQuantity(
      input.quantity
    );

  const aid = activityId(
    input.link.trim()
  );

  if (!SPORTS[sport]) {
    throw Error(
      'Choisis un sport proposé.'
    );
  }

  if (
    Date.now() < c.opens ||
    Date.now() > c.deadline ||
    c.paused ||
    c.final
  ) {
    throw Error(
      'Les dépôts ne sont pas ouverts.'
    );
  }

  if (
    all(
      'SELECT id FROM entries WHERE contest=? AND activity=?',
      c.id,
      aid
    ).length
  ) {
    throw Error(
      'Cette activité a déjà été déposée, même depuis un autre compte.'
    );
  }

  if (!input.proof) {
    throw Error(
      'Ajoute ta capture dans le formulaire.'
    );
  }

  const proof =
    await downloadProof(
      input.proof
    );

  const relative =
    `proofs/${id}.jpg`;

  fs.writeFileSync(
    path.join(
      root,
      relative
    ),
    proof.image
  );

  let e;

  try {
    e = S.add({
      id,
      contest: c.id,
      user: i.user.id,
      sport,
      day,
      quantity,
      activity: aid,
      hash: proof.hash,
      proof: relative,
      created: Date.now()
    });
  } catch (error) {
    fs.unlinkSync(
      path.join(
        root,
        relative
      )
    );

    if (
      String(
        error.message
      ).includes('UNIQUE')
    ) {
      throw Error(
        'Activité ou capture déjà déposée.'
      );
    }

    throw error;
  }

  let queued = false;

  try {
    await sendStaff(id);
  } catch (error) {
    queued = true;

    console.error(
      'Envoi staff à réessayer',
      id,
      error.message
    );
  }

  await i.editReply({
    embeds: [
      embed(
        'Activité envoyée ✅',
        `**${SPORTS[sport]} · ${n(quantity)} ${sport === 'strength' ? 'min' : 'km'}**
Date : ${day}

**${n(S.score(c, e))} points avant plafond**, après validation.

${queued
  ? 'Demande sauvegardée ; transmission au staff en attente.'
  : 'Ta preuve est entre les mains du staff.'}
ID : \`${id}\``
      )
    ],

    components: [
      row(
        btn(
          `mine:${c.id}:0`,
          'Mes activités'
        ),
        btn(
          `rank:${c.id}`,
          'Mon classement'
        )
      )
    ]
  });
}

async function updatePanel(c) {
  if (
    !c.panelMessage ||
    !c.panelChannel
  ) {
    return;
  }

  const channel =
    await client.channels.fetch(
      c.panelChannel
    );

  await channel.messages.edit(
    c.panelMessage,
    {
      embeds: [
        panel(c)
      ],
      components:
        panelButtons(c),
      allowedMentions: {
        parse: []
      }
    }
  );
}

const locks =
  new Set();

/* Gestion des interactions */

client.on(
  'interactionCreate',
  async i => {
    if (
      i.guildId !==
      env.DISCORD_GUILD_ID
    ) {
      return;
    }

    try {
      if (
        i.isModalSubmit() &&
        i.customId.startsWith(
          'activityform:'
        )
      ) {
        await i.deferReply({
          flags: E
        });

        const contestId =
          i.customId.split(':')[1];

        const c =
          requireContest(
            contestId
          );

        await submitActivity(
          i,
          c,
          {
            sport:
              i.fields
                .getStringSelectValues(
                  'sport'
                )[0],

            day:
              i.fields
                .getTextInputValue(
                  'day'
                ),

            quantity:
              i.fields
                .getTextInputValue(
                  'quantity'
                ),

            link:
              i.fields
                .getTextInputValue(
                  'link'
                ),

            proof:
              i.fields
                .getUploadedFiles(
                  'proof',
                  true
                )
                .first()
          }
        );

        return;
      }

      if (
        i.isChatInputCommand()
      ) {
        if (
          i.commandName !==
          'concours'
        ) {
          return;
        }

        if (!staff(i)) {
          throw Error(
            'Commande réservée au staff.'
          );
        }

        await i.deferReply({
          flags: E
        });

        const sub =
          i.options
            .getSubcommand();

        if (
          sub === 'creer'
        ) {
          const previous =
            S.active();

          if (
            previous &&
            !previous.final
          ) {
            throw Error(
              'Finalise le concours actuel avant d’en créer un autre.'
            );
          }

          const start = date(
            i.options.getString(
              'debut'
            )
          );

          const end = date(
            i.options.getString(
              'fin'
            )
          );

          const deadline = ISO(
            i.options.getString(
              'limite'
            )
          );

          const summer =
            new Intl.DateTimeFormat(
              'en-GB',
              {
                timeZone:
                  'Europe/Paris',

                timeZoneName:
                  'shortOffset'
              }
            ).format(
              new Date(
                start +
                'T12:00:00Z'
              )
            ).includes('GMT+2');

          const opens = ISO(
            start +
            'T00:00:00' +
            (
              summer
                ? '+02:00'
                : '+01:00'
            )
          );

          const endLocal =
            new Intl.DateTimeFormat(
              'en-CA',
              {
                timeZone:
                  'Europe/Paris',

                year:
                  'numeric',

                month:
                  '2-digit',

                day:
                  '2-digit'
              }
            ).format(
              new Date(
                deadline
              )
            );

          if (
            start > end ||
            deadline <=
              Date.now() ||
            endLocal <= end
          ) {
            throw Error(
              'La limite de dépôt doit être future et au moins le lendemain du dernier jour d’activité.'
            );
          }

          const c = {
            id:
              randomUUID()
                .slice(0, 12),

            title:
              i.options
                .getString(
                  'titre'
                ),

            start,
            end,
            opens,
            deadline,

            paused: false,
            final: false,

            rates: {
              run: 10,
              bike: 2,
              swim: 40,
              strength: 10 / 9,
              football: 10
            },

            strengthCap: 100
          };

          S.save(c);
          S.activate(c.id);

          await i.editReply(
            `Concours créé : ${c.id}. Utilise /concours publier.`
          );

          return;
        }

        const c =
          requireContest();

        if (
          sub ===
          'presentation'
        ) {
          const next = {
            ...c
          };

          const title =
            i.options.getString(
              'titre'
            );

          const text =
            i.options.getString(
              'texte'
            );

          const image =
            i.options.getString(
              'image'
            );

          const boardText =
            i.options.getString(
              'texte_classement'
            );

          if (
            title !== null
          ) {
            next.title =
              title;
          }

          if (
            text !== null
          ) {
            next.text =
              text === 'defaut'
                ? null
                : text;
          }

          if (
            image !== null
          ) {
            next.image =
              UI.imageURL(
                image
              );
          }

          if (
            boardText !== null
          ) {
            next.boardText =
              boardText ===
              'aucune'
                ? null
                : boardText;
          }

          S.save(next);

          await updatePanel(
            next
          );

          await refresh();

          await i.editReply(
            'Présentation enregistrée et panneaux existants actualisés. Les annonces déjà envoyées ailleurs ne sont pas modifiées.'
          );

          return;
        }

        if (
          sub ===
          'annoncer'
        ) {
          const channel =
            i.options
              .getChannel(
                'salon'
              );

          const role =
            i.options.getRole(
              'notification'
            );

          if (
            role?.id ===
            i.guildId
          ) {
            throw Error(
              'Sélectionne un rôle dédié, pas @everyone.'
            );
          }

          await channel.send({
            content: role
              ? `<@&${role.id}>`
              : undefined,

            embeds: [
              panel(c)
            ],

            components:
              panelButtons(c),

            allowedMentions: {
              parse: [],
              roles: role
                ? [role.id]
                : []
            }
          });

          await i.editReply(
            role
              ? 'Annonce envoyée avec le rôle demandé (notification selon permissions).'
              : 'Annonce envoyée sans ping.'
          );

          return;
        }

        if (
          sub === 'publier'
        ) {
          const participation =
            i.options
              .getChannel(
                'participation'
              );

          const board =
            i.options
              .getChannel(
                'classement'
              );

          const staffChannel =
            i.options
              .getChannel(
                'staff'
              );

          const tickets =
            i.options
              .getChannel(
                'tickets'
              );

          if (
            staffChannel
              .permissionsFor(
                i.guild.roles.everyone
              )
              ?.has(
                V.ViewChannel
              ) ||
            tickets
              .permissionsFor(
                i.guild.roles.everyone
              )
              ?.has(
                V.ViewChannel
              )
          ) {
            throw Error(
              'Le salon staff et la catégorie tickets doivent être privés. Retire Voir le salon à @everyone et vérifie les autres rôles.'
            );
          }

          c.panelChannel =
            participation.id;

          c.boardChannel =
            board.id;

          c.staffChannel =
            staffChannel.id;

          c.ticketCategory =
            tickets.id;

          S.save(c);

          if (
            c.panelMessage
          ) {
            try {
              await participation
                .messages.edit(
                  c.panelMessage,
                  {
                    embeds: [
                      panel(c)
                    ],

                    components:
                      panelButtons(c),

                    allowedMentions: {
                      parse: []
                    }
                  }
                );
            } catch (error) {
              if (
                error.code !==
                10008
              ) {
                throw error;
              }

              c.panelMessage =
                null;
            }
          }

          if (
            !c.panelMessage
          ) {
            const message =
              await participation
                .send({
                  embeds: [
                    panel(c)
                  ],

                  components:
                    panelButtons(c),

                  allowedMentions: {
                    parse: []
                  }
                });

            c.panelMessage =
              message.id;
          }

          S.save(c);

          if (
            c.boardMessage
          ) {
            try {
              await board
                .messages.edit(
                  c.boardMessage,
                  leaderboard(c)
                );
            } catch (error) {
              if (
                error.code !==
                10008
              ) {
                throw error;
              }

              c.boardMessage =
                null;
            }
          }

          if (
            !c.boardMessage
          ) {
            const message =
              await board.send(
                leaderboard(c)
              );

            c.boardMessage =
              message.id;
          }

          S.save(c);

          await i.editReply(
            'Participation et classement publiés. Aucun ping envoyé.'
          );

          return;
        }

        if (
          sub === 'bareme'
        ) {
          const existing = all(
            'SELECT id FROM entries WHERE contest=? LIMIT 1',
            c.id
          );

          if (
            existing.length
          ) {
            throw Error(
              'Barème figé dès le premier dépôt.'
            );
          }

          for (
            const [option, key]
            of [
              ['course', 'run'],
              ['velo', 'bike'],
              ['natation', 'swim'],
              ['muscu', 'strength'],
              ['foot', 'football']
            ]
          ) {
            const value =
              i.options
                .getNumber(
                  option
                );

            if (
              value !== null
            ) {
              c.rates[key] =
                value;
            }
          }

          const cap =
            i.options
              .getNumber(
                'plafond_muscu'
              );

          if (
            cap !== null
          ) {
            c.strengthCap =
              cap;
          }

          S.save(c);

          await i.editReply(
            'Barème enregistré. Relance /concours publier pour actualiser le panneau.'
          );

          return;
        }

        if (
          sub === 'pause' ||
          sub === 'reprendre'
        ) {
          if (c.final) {
            throw Error(
              'Concours finalisé.'
            );
          }

          c.paused =
            sub === 'pause';

          S.save(c);

          await i.editReply(
            c.paused
              ? 'Dépôts fermés.'
              : 'Dépôts réactivés, sous réserve des dates.'
          );

          return;
        }

        if (
          sub ===
          'finaliser'
        ) {
          if (
            !c.paused &&
            Date.now() <
              c.deadline
          ) {
            throw Error(
              'Ferme les dépôts avec /concours pause avant de finaliser.'
            );
          }

          const pending = all(
            "SELECT id FROM entries WHERE contest=? AND status='pending' LIMIT 1",
            c.id
          );

          if (
            pending.length
          ) {
            throw Error(
              'Traite toutes les demandes en attente avant de finaliser.'
            );
          }

          c.final = true;
          c.paused = true;

          S.save(c);

          await refresh();

          await i.editReply(
            'Résultats figés. Les preuves ne sont pas supprimées automatiquement.'
          );

          return;
        }

        if (
          sub === 'retirer'
        ) {
          const e = entry(
            i.options
              .getString(
                'id'
              )
          );

          if (
            e.contest !==
            c.id
          ) {
            throw Error(
              'Activité d’un autre concours.'
            );
          }

          const updated =
            S.review(
              e.id,
              i.user.id,
              'revoked',
              i.options
                .getString(
                  'motif'
                )
            );

          await refresh();

          try {
            await sendStaff(
              e.id
            );
          } catch (error) {
            console.error(
              error
            );
          }

          await notify(
            updated,
            `Activité ${e.id} retirée : ${updated.reason}. Consulte ton classement actualisé.`
          );

          await i.editReply(
            'Activité retirée, totaux recalculés.'
          );

          return;
        }

        if (
          sub === 'export'
        ) {
          const data = [
            'Rang,Discord ID,Points,Activites',

            ...S.ranking(c.id)
              .map(x => [
                x.rank,
                x.user,
                x.points,
                x.activities
              ].join(','))
          ].join('\r\n');

          await i.editReply({
            files: [
              new AttachmentBuilder(
                Buffer.from(
                  '\uFEFF' +
                  data
                ),
                {
                  name:
                    `classement-${c.id}.csv`
                }
              )
            ]
          });

          return;
        }

        if (
          sub ===
          'sauvegarde'
        ) {
          const target =
            path.join(
              root,
              'export.sqlite'
            );

          try {
            fs.unlinkSync(
              target
            );
          } catch {}

          S.db.exec(
            `VACUUM INTO '${target.replace(
              /'/g,
              "''"
            )}'`
          );

          await i.editReply({
            content:
              'Base privée : données, décisions et barèmes. Les images ne sont pas incluses ; sauvegarde aussi le dossier proofs du volume.',

            files: [
              new AttachmentBuilder(
                target,
                {
                  name:
                    'sport-backup.sqlite'
                }
              )
            ]
          });

          return;
        }

        if (
          sub ===
          'diagnostic'
        ) {
          const counts = all(
            'SELECT status,COUNT(*) AS total FROM entries WHERE contest=? GROUP BY status',
            c.id
          );

          await i.editReply(
            `Concours : ${c.id}
Période : ${c.start} / ${c.end}
Limite : ${new Date(c.deadline).toISOString()}
Pause : ${c.paused} · Final : ${c.final}
Demandes : ${JSON.stringify(counts)}
DATA_DIR : ${root}

${rules(c)}`
          );

          return;
        }

        if (
          sub ===
          'relancer'
        ) {
          const pending = all(
            "SELECT id FROM entries WHERE contest=? AND status='pending' AND staff_message IS NULL LIMIT 10",
            c.id
          );

          let sent = 0;

          for (
            const e of pending
          ) {
            try {
              await sendStaff(
                e.id
              );

              sent++;
            } catch (error) {
              console.error(
                error
              );
            }
          }

          await refresh();

          await i.editReply(
            `${sent}/${pending.length} demande(s) transmise(s). Relance si plus de 10 étaient en attente.`
          );

          return;
        }

        if (
          sub ===
          'corriger'
        ) {
          const e = entry(
            i.options
              .getString(
                'id'
              )
          );

          const quantity =
            i.options
              .getNumber(
                'quantite'
              );

          if (
            e.contest !==
              c.id ||
            c.final ||
            e.status ===
              'approved'
          ) {
            throw Error(
              'Corrige une demande en attente/refusée du concours actuel. Retire une validation avant correction.'
            );
          }

          if (
            e.sport ===
              'strength' &&
            quantity > 1440
          ) {
            throw Error(
              'Maximum 1440 minutes.'
            );
          }

          S.transaction(
            () => {
              S.db.prepare(`
                UPDATE entries
                SET quantity=?,
                    status='pending',
                    reason=NULL,
                    points=0
                WHERE id=?
              `).run(
                quantity,
                e.id
              );

              S.db.prepare(`
                INSERT INTO audit(
                  entry,
                  actor,
                  action,
                  reason,
                  at
                ) VALUES(?,?,?,?,?)
              `).run(
                e.id,
                i.user.id,
                'corrected',
                String(
                  e.quantity
                ) +
                  ' -> ' +
                  quantity,
                Date.now()
              );
            }
          );

          await sendStaff(
            e.id
          );

          await notify(
            e,
            `Activité ${e.id} corrigée : ${n(quantity)}, nouvelle vérification en attente.`
          );

          await i.editReply(
            'Demande corrigée et remise en attente.'
          );

          return;
        }

        if (
          sub ===
          'clore-ticket'
        ) {
          const e = entry(
            i.options
              .getString(
                'id'
              )
          );

          if (
            !e.ticket
          ) {
            throw Error(
              'Aucun ticket.'
            );
          }

          const channel =
            await client
              .channels.fetch(
                e.ticket
              );

          await channel.delete(
            'Ticket clos par le staff'
          );

          S.db.prepare(`
            UPDATE entries
            SET ticket=NULL
            WHERE id=?
          `).run(
            e.id
          );

          await i.editReply(
            'Ticket supprimé.'
          );

          return;
        }
      }

      if (
        i.isButton()
      ) {
        const [
          action,
          id,
          pageRaw
        ] = i.customId.split(
          ':'
        );

        if ([
          'approve',
          'reject',
          'talk'
        ].includes(action)) {
          if (!staff(i)) {
            throw Error(
              'Réservé au staff.'
            );
          }

          const e =
            entry(id);

          const c =
            requireContest(
              e.contest
            );

          if (
            action ===
            'reject'
          ) {
            const input =
              new TextInputBuilder()
                .setCustomId(
                  'reason'
                )
                .setLabel(
                  'Motif du refus'
                )
                .setStyle(
                  TextInputStyle
                    .Paragraph
                )
                .setMaxLength(
                  500
                )
                .setRequired(
                  true
                );

            const modal =
              new ModalBuilder()
                .setCustomId(
                  `reject:${id}`
                )
                .setTitle(
                  'Refuser l’activité'
                )
                .addComponents(
                  row(input)
                );

            await i.showModal(
              modal
            );

            return;
          }

          await i.deferReply({
            flags: E
          });

          if (
            action ===
            'approve'
          ) {
            const updated =
              S.review(
                id,
                i.user.id,
                'approved'
              );

            await refresh();

            try {
              await sendStaff(
                id
              );
            } catch (error) {
              console.error(
                error
              );
            }

            await notify(
              updated,
              `✅ Activité ${id} validée : ${n(updated.points)} points attribués (plafond musculation appliqué si nécessaire).`
            );

            await i.editReply(
              `Activité validée : ${n(updated.points)} points.`
            );

            return;
          }

          if (c.final) {
            throw Error(
              'Concours finalisé.'
            );
          }

          if (
            locks.has(id)
          ) {
            throw Error(
              'Création du ticket en cours.'
            );
          }

          locks.add(id);

          try {
            if (
              e.ticket
            ) {
              const existing =
                await client
                  .channels.fetch(
                    e.ticket
                  )
                  .catch(
                    () => null
                  );

              if (
                existing
              ) {
                await i.editReply(
                  `Ticket : <#${e.ticket}>`
                );

                return;
              }
            }

            const channel =
              await i.guild
                .channels.create({
                  name:
                    `activite-${id}`,

                  type:
                    ChannelType
                      .GuildText,

                  parent:
                    c.ticketCategory,

                  permissionOverwrites: [
                    {
                      id:
                        i.guild.id,
                      deny: [
                        V.ViewChannel
                      ]
                    },
                    {
                      id:
                        e.user,
                      allow: [
                        V.ViewChannel,
                        V.SendMessages,
                        V.ReadMessageHistory,
                        V.AttachFiles
                      ]
                    },
                    {
                      id:
                        env.ADMIN_ROLE_ID,
                      allow: [
                        V.ViewChannel,
                        V.SendMessages,
                        V.ReadMessageHistory,
                        V.AttachFiles
                      ]
                    },
                    {
                      id:
                        client.user.id,
                      allow: [
                        V.ViewChannel,
                        V.SendMessages,
                        V.ReadMessageHistory,
                        V.AttachFiles,
                        V.EmbedLinks
                      ]
                    }
                  ]
                });

            S.db.prepare(`
              UPDATE entries
              SET ticket=?
              WHERE id=?
            `).run(
              channel.id,
              id
            );

            await channel.send({
              content:
                `<@${e.user}> Le staff souhaite une précision sur ton activité **${SPORTS[e.sport]} du ${e.day}** (${n(e.quantity)} ${e.sport === 'strength' ? 'min' : 'km'}). L’équipe te précise ici ce qu’il manque.`,

              allowedMentions: {
                users: [
                  e.user
                ]
              }
            });

            await notify(
              e,
              `Une précision est nécessaire pour l’activité ${id} : https://discord.com/channels/${i.guildId}/${channel.id}`
            );

            await i.editReply(
              `Ticket créé : <#${channel.id}>`
            );
          } finally {
            locks.delete(id);
          }

          return;
        }

        const c =
          requireContest(id);

        if (
          action === 'add'
        ) {
          if (
            !c.staffChannel
          ) {
            throw Error(
              'Le concours n’est pas encore publié.'
            );
          }

          if (
            Date.now() <
              c.opens ||
            Date.now() >
              c.deadline ||
            c.paused ||
            c.final
          ) {
            throw Error(
              'Les dépôts ne sont pas ouverts.'
            );
          }

          const today =
            new Intl.DateTimeFormat(
              'fr-FR',
              {
                timeZone:
                  'Europe/Paris'
              }
            ).format(
              new Date()
            );

          await i.showModal(
            UI.modal(
              c.id,
              today
            )
          );

          return;
        }

        if (
          action === 'help'
        ) {
          await i.reply({
            embeds: [
              embed(
                'Barème du concours',
                rules(c)
              )
            ],
            flags: E
          });

          return;
        }

        if (
          action === 'rank'
        ) {
          const list =
            S.ranking(
              c.id
            );

          const user =
            list.find(
              x =>
                x.user ===
                i.user.id
            );

          const pending =
            all(
              "SELECT id FROM entries WHERE contest=? AND user=? AND status='pending'",
              c.id,
              i.user.id
            ).length;

          const text = user
            ? `**Rang ${user.rank} sur ${list.length}**

🏆 **${n(user.points)} points**
✅ ${user.activities} activité(s) validée(s)
⏳ ${pending} en attente`
            : `Aucune activité validée.
⏳ ${pending} demande(s) en attente.`;

          await i.reply({
            embeds: [
              embed(
                'Mon classement',
                text
              )
            ],
            flags: E
          });

          return;
        }

        if (
          action ===
          'board'
        ) {
          await i.deferReply({
            flags: E
          });

          await i.editReply(
            leaderboard(
              c,
              Number(
                pageRaw
              ) || 0
            )
          );

          return;
        }

        if (
          action ===
          'mine'
        ) {
          const page =
            Math.max(
              0,
              Number(
                pageRaw
              ) || 0
            );

          const entries =
            all(
              'SELECT * FROM entries WHERE contest=? AND user=? ORDER BY created DESC LIMIT 8 OFFSET ?',
              c.id,
              i.user.id,
              page * 8
            );

          const text =
            entries.length
              ? entries.map(
                  e =>
                    `**${e.id}** · ${SPORTS[e.sport]} · ${e.day}\n` +
                    `${n(e.quantity)} ${e.sport === 'strength' ? 'min' : 'km'} · ` +
                    `**${e.status}** · ${n(e.points)} pts` +
                    (
                      e.reason
                        ? '\nMotif : ' +
                          e.reason
                        : ''
                    ) +
                    (
                      e.ticket
                        ? '\nDiscussion : <#' +
                          e.ticket +
                          '>'
                        : ''
                    )
                ).join(
                  '\n\n'
                )
              : 'Aucune autre activité.';

          await i.reply({
            embeds: [
              embed(
                'Mes activités',
                text
              )
            ],

            components: [
              row(
                btn(
                  `mine:${c.id}:${Math.max(0, page - 1)}`,
                  '←'
                ),
                btn(
                  `mine:${c.id}:${page + 1}`,
                  '→'
                )
              )
            ],

            flags: E,

            allowedMentions: {
              parse: []
            }
          });

          return;
        }
      }

      if (
        i.isModalSubmit() &&
        i.customId.startsWith(
          'reject:'
        )
      ) {
        if (!staff(i)) {
          throw Error(
            'Réservé au staff.'
          );
        }

        await i.deferReply({
          flags: E
        });

        const id =
          i.customId
            .split(':')[1];

        const e =
          S.review(
            id,
            i.user.id,
            'rejected',
            i.fields
              .getTextInputValue(
                'reason'
              )
          );

        try {
          await sendStaff(id);
        } catch (error) {
          console.error(
            error
          );
        }

        await notify(
          e,
          `❌ Activité ${id} refusée : ${e.reason}. Si besoin, contacte le staff pour une précision.`
        );

        await i.editReply(
          'Demande refusée. Motif disponible dans Mes activités et envoyé en DM si possible.'
        );
      }
    } catch (error) {
      console.error(
        'Interaction :',
        error.message
      );

      const payload = {
        content: String(
          error.message ||
          'Erreur inattendue.'
        ).slice(
          0,
          1800
        ),

        allowedMentions: {
          parse: []
        }
      };

      try {
        if (
          i.deferred
        ) {
          await i.editReply(
            payload
          );
        } else if (
          i.replied
        ) {
          await i.followUp({
            ...payload,
            flags: E
          });
        } else {
          await i.reply({
            ...payload,
            flags: E
          });
        }
      } catch (
        responseError
      ) {
        console.error(
          'Réponse :',
          responseError.message
        );
      }
    }
  }
);

client.once(
  'clientReady',
  () => {
    console.log(
      `Nutrimuscle Sport prêt : ${client.user.tag}`
    );

    refresh().catch(
      console.error
    );
  }
);

async function start() {
  await new REST({
    version: '10'
  })
    .setToken(
      env.DISCORD_TOKEN
    )
    .put(
      Routes
        .applicationGuildCommands(
          env.DISCORD_CLIENT_ID,
          env.DISCORD_GUILD_ID
        ),
      {
        body: [
          adminCmd.toJSON()
        ]
      }
    );

  await client.login(
    env.DISCORD_TOKEN
  );
}

start().catch(
  error => {
    console.error(
      'Démarrage :',
      error
    );

    process.exit(1);
  }
);

for (
  const signal of [
    'SIGTERM',
    'SIGINT'
  ]
) {
  process.on(
    signal,
    () => {
      client.destroy();
      S.db.close();
      process.exit(0);
    }
  );
}
