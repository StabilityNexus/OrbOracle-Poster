<!-- Don't delete it -->
<div name="readme-top"></div>

<!-- Organization Logo -->
<div align="center" style="display: flex; align-items: center; justify-content: center; gap: 16px;">
  <img alt="Stability Nexus" src="public/stability.svg" width="175">
  <img src="public/todo-project-logo.svg" width="175" />
</div>

&nbsp;

<!-- Organization Name -->
<div align="center">

[![Static Badge](https://img.shields.io/badge/Stability_Nexus-/TODO-228B22?style=for-the-badge&labelColor=FFC517)](https://TODO.stability.nexus/)

<!-- Correct deployed url to be added -->

</div>

<!-- Organization/Project Social Handles -->
<p align="center">
<!-- Telegram -->
<a href="https://t.me/StabilityNexus">
<img src="https://img.shields.io/badge/Telegram-black?style=flat&logo=telegram&logoColor=white&logoSize=auto&color=24A1DE" alt="Telegram Badge"/></a>
&nbsp;&nbsp;
<!-- X (formerly Twitter) -->
<a href="https://x.com/StabilityNexus">
<img src="https://img.shields.io/twitter/follow/StabilityNexus" alt="X (formerly Twitter) Badge"/></a>
&nbsp;&nbsp;
<!-- Discord -->
<a href="https://discord.gg/YzDKeEfWtS">
<img src="https://img.shields.io/discord/995968619034984528?style=flat&logo=discord&logoColor=white&logoSize=auto&label=Discord&labelColor=5865F2&color=57F287" alt="Discord Badge"/></a>
&nbsp;&nbsp;
<!-- Medium -->
<a href="https://news.stability.nexus/">
  <img src="https://img.shields.io/badge/Medium-black?style=flat&logo=medium&logoColor=black&logoSize=auto&color=white" alt="Medium Badge"></a>
&nbsp;&nbsp;
<!-- LinkedIn -->
<a href="https://linkedin.com/company/stability-nexus">
  <img src="https://img.shields.io/badge/LinkedIn-black?style=flat&logo=LinkedIn&logoColor=white&logoSize=auto&color=0A66C2" alt="LinkedIn Badge"></a>
&nbsp;&nbsp;
<!-- Youtube -->
<a href="https://www.youtube.com/@StabilityNexus">
  <img src="https://img.shields.io/youtube/channel/subscribers/UCZOG4YhFQdlGaLugr_e5BKw?style=flat&logo=youtube&logoColor=white&logoSize=auto&labelColor=FF0000&color=FF0000" alt="Youtube Badge"></a>
</p>

---

<div align="center">
<h1>OrbOracle Poster</h1>
</div>

[OrbOracle Poster](https://github.com/DeveloperAmrit/OrbOracle-Poster) automates the value submission to an oracle launched in OrbOracle. It fetches values from networks like ChainLink, Pyth, or general REST APIs, and submits them to an OrbOracle contract on behalf of the user.


## Tech Stack

### Backend & Core

- Node.js (TypeScript)
- Ethers.js (Blockchain interaction)
- Axios (HTTP requests)
- Jest (Testing)

### Infrastructure

- Docker & Docker Compose

---

## Getting Started

### Prerequisites


- Node.js 18+
- npm/yarn/pnpm
- MetaMask or any other web3 wallet browser extension
- An oracle on OrbOracle

### Installation

#### 1. Fork and Clone the Repository

```bash
git clone https://github.com/DeveloperAmrit/OrbOracle-Poster.git
cd OrbOracle-Poster
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and configure the following variables:
- `RPC_URL`: The JSON-RPC endpoint for your node provider (e.g., Alchemy, Infura, or a local node).
- `PRIVATE_KEY`: The private key of the wallet submitting the transactions.
- `ORACLE_ADDRESS`: The deployed OrbOracle contract address.
- `FEED_URL`: The REST API URL for fetching prices (e.g., CoinGecko, Binance, Pyth off-chain API).
- `CHAINLINK_FEED_ADDRESS` *(Optional)*: Chainlink Aggregator Contract Address to fetch values from Chainlink.
- `CHAINLINK_RPC_URL` *(Optional)*: RPC URL used specifically for the Chainlink feed. Defaults to `RPC_URL` if omitted.
- `PYTH_PRICE_ID`: The Pyth Price Feed ID (Defaults to ADA/USD).
- `UPDATE_INTERVAL_MS`: Frequency of submissions in milliseconds.
- `MIN_STAKE_REQUIRED`: Minimum token amount required to submit.

#### 4. Launch the App

Start the poster using:

```bash
npm start
```

---

## Contributing

We welcome contributions of all kinds! To contribute:

1. Fork the repository and create your feature branch (`git checkout -b feature/AmazingFeature`).
2. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
3. Run the development workflow commands to ensure code quality:
   - `npm run format:write`
   - `npm run lint:fix`
   - `npm run typecheck`
4. Push your branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request for review.

If you encounter bugs, need help, or have feature requests:

- Please open an issue in this repository providing detailed information.
- Describe the problem clearly and include any relevant logs or screenshots.

We appreciate your feedback and contributions!

© 2025 The Stable Order.
