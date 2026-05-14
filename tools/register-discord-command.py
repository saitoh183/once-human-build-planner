#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

APPLICATION_ID = '1504349714282188892'
DEFAULT_GUILD_ID = '859864250919157811'
ENV_KEY = 'Discord_Bot_Token_OH'


def load_env_value(key: str) -> str:
    if os.getenv(key):
        return os.environ[key]

    env_path = Path.home() / '.hermes' / '.env'
    for line in env_path.read_text(encoding='utf-8').splitlines():
        if not line or line.lstrip().startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        if name == key:
            return value.strip().strip('"').strip("'")
    raise RuntimeError(f'Missing {key}')


def discord_request(method: str, path: str, body=None):
    token = load_env_value(ENV_KEY)
    data = json.dumps(body).encode('utf-8') if body is not None else None
    request = urllib.request.Request(
        f'https://discord.com/api/v10{path}',
        data=data,
        method=method,
        headers={
            'Authorization': f'Bot {token}',
            'Content-Type': 'application/json',
            'User-Agent': 'OnceHumanBuildPlanner/1.0'
        }
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode('utf-8')
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        body = error.read().decode('utf-8', 'replace')
        raise RuntimeError(f'Discord API HTTP {error.code}: {body}') from None


COMMANDS = [
    {
        'name': 'searchbuild',
        'description': 'Search Once Human builds by gun and HP type',
        'dm_permission': False,
        'options': [
            {
                'type': 3,
                'name': 'gun',
                'description': 'Full or partial gun name',
                'required': True,
                'min_length': 2,
                'max_length': 80
            },
            {
                'type': 3,
                'name': 'hp',
                'description': 'Build HP selection',
                'required': True,
                'choices': [
                    {'name': 'High HP', 'value': 'High HP'},
                    {'name': 'Low HP', 'value': 'Low HP'}
                ]
            }
        ]
    },
    {
        'name': 'setup',
        'description': 'Configure OHBot for this server',
        'dm_permission': False,
        # Discord permission bit: Manage Guild / Manage Server.
        'default_member_permissions': str(1 << 5),
        'options': [
            {
                'type': 1,
                'name': 'set',
                'description': 'Restrict OHBot commands to a channel',
                'options': [
                    {
                        'type': 7,
                        'name': 'channel',
                        'description': 'Channel where OHBot commands should work; defaults to the current channel',
                        'required': False,
                        'channel_types': [0, 5, 10, 11, 12]
                    }
                ]
            },
            {
                'type': 1,
                'name': 'remove',
                'description': 'Remove the configured OHBot channel restriction'
            },
            {
                'type': 1,
                'name': 'status',
                'description': 'Show the current OHBot channel restriction'
            }
        ]
    }
]


def parse_args():
    parser = argparse.ArgumentParser(description='Register OHBot Discord slash commands.')
    parser.add_argument(
        '--scope',
        choices=('guild', 'global'),
        default='guild',
        help='Register guild commands for fast testing or global commands for installed servers. Default: guild.'
    )
    parser.add_argument('--guild-id', default=DEFAULT_GUILD_ID, help='Guild ID used with --scope guild.')
    return parser.parse_args()


if __name__ == '__main__':
    args = parse_args()
    if args.scope == 'guild':
        api_path = f'/applications/{APPLICATION_ID}/guilds/{args.guild_id}/commands'
        target = {'scope': 'guild', 'guild_id': args.guild_id}
    else:
        api_path = f'/applications/{APPLICATION_ID}/commands'
        target = {'scope': 'global'}

    # Bulk overwrite keeps this scope clean instead of stacking stale duplicates.
    status, payload = discord_request('PUT', api_path, COMMANDS)
    print(json.dumps({
        'status': status,
        **target,
        'commands': [
            {
                'id': command.get('id'),
                'name': command.get('name'),
                'options': [option['name'] for option in command.get('options', [])]
            }
            for command in payload
        ]
    }, indent=2))
