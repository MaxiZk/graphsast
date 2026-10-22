import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
public class ReglaController {
    private static final Map<String, Double> DESCUENTOS = Map.of("basico", 0.1, "premium", 0.2);

    @GetMapping("/regla")
    public Object evaluar(@RequestParam String regla) {
        return DESCUENTOS.getOrDefault(regla, 0.0);
    }
}
