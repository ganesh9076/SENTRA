# SENTRA – Distributed Threat Intelligence Sharing System

## Overview

SENTRA is a Distributed Threat Intelligence Sharing System designed to facilitate the collection, analysis, and sharing of cybersecurity threat intelligence across multiple nodes. The platform enables organizations and security teams to collaboratively identify, monitor, and respond to emerging cyber threats in real time.

By leveraging a distributed architecture, SENTRA improves threat visibility, accelerates incident response, and enhances collective cyber defense capabilities.

## Key Features

* Real-time threat intelligence sharing
* Distributed threat data collection
* Threat scoring and risk assessment
* Security event monitoring
* Threat activity visualization
* Secure data exchange between nodes
* Interactive analytics dashboard
* Centralized threat intelligence repository

## System Architecture

The system follows a distributed architecture where multiple nodes contribute threat information to a shared intelligence network. Each node can:

* Report suspicious activities
* Share Indicators of Compromise (IOCs)
* Receive threat updates from other nodes
* Analyze and visualize threat trends
* Support collaborative threat mitigation

## Technology Stack

### Frontend

* HTML5
* CSS3
* JavaScript

### Backend

* Node.js
* Express.js

### Database

* MongoDB

### Additional Technologies

* REST APIs
* JSON-based threat intelligence exchange
* Distributed communication mechanisms

## Installation

### Prerequisites

* Node.js
* MongoDB
* Git

### Clone the Repository

```bash
git clone https://github.com/ganesh9076/SENTRA.git
cd SENTRA
```

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Create a `.env` file:

```env
MONGO_URI=your_mongodb_connection_string
PORT=5000
```

### Run the Application

```bash
node server.js
```

The application will be available at:

```text
http://localhost:5000
```

## Project Structure

```text
SENTRA/
├── backend/
├── css/
├── js/
├── images/
├── server.js
├── package.json
├── package-lock.json
└── README.md
```

## Future Enhancements

* Blockchain-based threat intelligence validation
* AI-powered threat prediction
* Automated threat correlation
* Integration with SIEM platforms
* Real-time alerting and notifications
* Threat intelligence feeds integration
* Advanced analytics and reporting

## Applications

* Security Operations Centers (SOC)
* Enterprise Cybersecurity Monitoring
* Threat Intelligence Research
* Incident Response Teams
* Collaborative Cyber Defense Networks

## Project Team

SENTRA was developed as a collaborative cybersecurity project by:

- **Ganesh Palav**
- **Aditya Gupta**
- **Aditya Bankar**
- **Pratik Jingare**

Each team member contributed to the design, development, testing, and implementation of the Distributed Threat Intelligence Sharing System.

## Author

**Ganesh**

* GitHub: https://github.com/ganesh9076

## License

This project is intended for educational, research, and cybersecurity learning purposes.
