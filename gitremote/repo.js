/* global require, module */
const request = require('superagent');
const pull = require('pull-stream');
const process = require('process');
const crypto = require('crypto');
const Web3 = require('web3');

const repoABI = require('../contracts/Repository.json');

function gitHash (obj, data) {
    let hasher = crypto.createHash('sha1');
    hasher.update(obj.type + ' ' + obj.length + '\0');
    hasher.update(data);
    return hasher.digest('hex');
}

const ObjectTypes = ['tag', 'commit', 'tree', 'blob'];

class Repo {
    constructor (address, user) {
        let providerAddress = process.env['ETHEREUM_RPC_URL'] || 'http://localhost:8545';
        this.web3 = new Web3(
            new Web3.providers.HttpProvider(providerAddress)
        );
        this.web3.eth.defaultAccount = user || this.web3.eth.coinbase;
        this.repoContract = this.web3.eth.contract(repoABI).at(address);
    }

    refs () {
        let transactionsLeft = Number(this.repoContract.transactionCount());
        if (transactionsLeft === 0) {
            return (abort, cb) => {
                cb(true);
            };
        }
        let evt;
        let refs = new Promise((resolve) => {
            let refObject = {};
            evt = this.repoContract.allEvents({ fromBlock: 0, toBlock: 'latest' }, (err, result) => {
                let { refname, hash } = result.args;
                refname = this.web3.toAscii(refname.replace(/0*$/, ''));
                switch (result.event) {
                case 'CreateRef':
                    refObject[refname] = hash;
                    transactionsLeft--;
                    break;
                case 'UpdateRef':
                    refObject[refname] = hash;
                    transactionsLeft--;
                    break;
                case 'DeleteRef':
                    delete refObject[refname];
                    transactionsLeft--;
                    break;
                }
                if (transactionsLeft == 0) {
                    evt.stopWatching();
                    resolve(refObject);
                }
            });
        });

        return (() => {
            let pendingCallback;
            let allRefs;

            refs.then(refObject => {
                allRefs = Object.keys(refObject).map(name => ({
                    name,
                    hash: refObject[name]
                }));
                if (pendingCallback) {
                    pendingCallback();
                }
            });

            let readRef = cb => {
                if (allRefs.length > 0) {
                    cb(null, allRefs.pop());
                } else {
                    cb(true);
                }
            };

            return (abort, cb) => {
                if (abort) {
                    cb(true);
                } else if (allRefs) {
                    readRef(cb);
                } else {
                    pendingCallback = () => {
                        readRef(cb);
                    };
                }
            };
        })();
    }

    symrefs () {
        let symrefs = [{
            name: 'HEAD',
            ref: 'refs/heads/master'
        }];
        return (abort, cb) => {
            if (abort) {
                cb(true);
            } else if (symrefs.length > 0) {
                cb(null, symrefs.pop());
            } else {
                cb(true, null);
            }
        };
    }

    hasObject (hash, cb) {
        this.repoContract.objects(hash, (err, result) => {
            if (result[1].length > 0) {
                cb(err, true);
            } else {
                cb(err, false);
            }
        });
    }

    getObject (hash, cb) {
        this.repoContract.objects(hash, (err, result) => {
            if (err) {
                cb(err);
            } else {
                request.get('http://localhost:8500/bzzr:/' + result[1]).end((err, res) => {
                    if (err) {
                        cb(err);
                    } else {
                        let { length } = res.body;
                        cb(null, {
                            length,
                            type: ObjectTypes[Number(result[0])],
                            read: (abort, cb) => {
                                if (abort) {
                                    cb(true);
                                } else {
                                    cb(true, res.body);
                                }
                            }
                        });
                    }
                });
            }
        });
    }

    update (refs, objects, cb) {
        if (refs) {
            refs(null, (abort, { old, new: newVal, name }) => {
                process.stderr.write(JSON.stringify({ old, newVal, name }));
            });
        }

        if (objects) {
            objects(null, (abort, { type, length, offset }) => {
            });
        }
        cb(true);
    }
}

module.exports = Repo;
