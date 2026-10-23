namespace UpgradeApp;

public sealed class GreetingService
{
    public string Create(string name)
    {
        return $"Hello, {(string.IsNullOrEmpty(name) ? "world" : name)}!";
    }
}
